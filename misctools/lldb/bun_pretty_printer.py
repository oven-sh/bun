# Pretty printers for Bun data structures
import lldb
import re

class bun_BabyList_SynthProvider:
    def __init__(self, value, _=None): 
        self.value = value
        
    def update(self):

        try:
            self.ptr = self.value.GetChildMemberWithName('ptr')
            self.len = self.value.GetChildMemberWithName('len').GetValueAsUnsigned()
            self.cap = self.value.GetChildMemberWithName('cap').GetValueAsUnsigned()
            self.elem_type = self.ptr.type.GetPointeeType()
            self.elem_size = self.elem_type.size
        except:
            self.len = 0
            self.cap = 0
            pass

            
    def has_children(self): 
        return True
        
    def num_children(self): 
        return self.len or 0
        
    def get_child_index(self, name):
        try: 
            return int(name.removeprefix('[').removesuffix(']'))
        except: 
            return -1
            
    def get_child_at_index(self, index):
        if index not in range(self.len): 
            return None
        try: 
            return self.ptr.CreateChildAtOffset('[%d]' % index, index * self.elem_size, self.elem_type)
        except: 
            return None

def bun_BabyList_SummaryProvider(value, _=None):
    try:
        # Get the non-synthetic value to access raw members
        value = value.GetNonSyntheticValue()
        len_val = value.GetChildMemberWithName('len')
        cap_val = value.GetChildMemberWithName('cap')
        return 'len=%d cap=%d' % (len_val.GetValueAsUnsigned(), cap_val.GetValueAsUnsigned())
    except:
        return 'len=? cap=?'

def add(debugger, *, category, regex=False, type, identifier=None, synth=False, inline_children=False, expand=False, summary=False):
    prefix = '.'.join((__name__, (identifier or type).replace('.', '_').replace(':', '_')))
    if summary: 
        debugger.HandleCommand('type summary add --category %s%s%s "%s"' % (
            category, 
            ' --inline-children' if inline_children else ''.join((' --expand' if expand else '', ' --python-function %s_SummaryProvider' % prefix if summary == True else ' --summary-string "%s"' % summary)), 
            ' --regex' if regex else '', 
            type
        ))
    if synth: 
        debugger.HandleCommand('type synthetic add --category %s%s --python-class %s_SynthProvider "%s"' % (
            category, 
            ' --regex' if regex else '', 
            prefix, 
            type
        ))

def WTFStringImpl_SummaryProvider(value, _=None):
    try:
        # Get the raw pointer (it's already a pointer type)
        value = value.GetNonSyntheticValue()
        
        # Check if it's a pointer type and dereference if needed
        if value.type.IsPointerType():
            struct = value.deref
        else:
            struct = value
        
        m_length = struct.GetChildMemberWithName('m_length').GetValueAsUnsigned()
        m_hashAndFlags = struct.GetChildMemberWithName('m_hashAndFlags').GetValueAsUnsigned()
        m_ptr = struct.GetChildMemberWithName('m_ptr')
        
        # Check if it's 8-bit (latin1) or 16-bit (utf16) string
        s_hashFlag8BitBuffer = 1 << 2
        is_8bit = (m_hashAndFlags & s_hashFlag8BitBuffer) != 0
        
        if m_length == 0:
            return '[%s] ""' % ('latin1' if is_8bit else 'utf16')
        
        # Limit memory reads to 1MB for performance
        MAX_BYTES = 1024 * 1024  # 1MB
        MAX_DISPLAY_CHARS = 200  # Maximum characters to display
        
        # Calculate how much to read
        bytes_per_char = 1 if is_8bit else 2
        total_bytes = m_length * bytes_per_char
        truncated = False
        
        if total_bytes > MAX_BYTES:
            # Read only first part of very large strings
            chars_to_read = MAX_BYTES // bytes_per_char
            bytes_to_read = chars_to_read * bytes_per_char
            truncated = True
        else:
            chars_to_read = m_length
            bytes_to_read = total_bytes
        
        if is_8bit:
            # Latin1 string
            latin1_ptr = m_ptr.GetChildMemberWithName('latin1')
            process = value.process
            error = lldb.SBError()
            ptr_addr = latin1_ptr.GetValueAsUnsigned()
            if ptr_addr:
                byte_data = process.ReadMemory(ptr_addr, min(chars_to_read, m_length), error)
                if error.Success():
                    string_val = byte_data.decode('latin1', errors='replace')
                else:
                    return '[latin1] <read error: %s>' % error
            else:
                return '[latin1] <null ptr>'
        else:
            # UTF16 string
            utf16_ptr = m_ptr.GetChildMemberWithName('utf16')
            process = value.process
            error = lldb.SBError()
            ptr_addr = utf16_ptr.GetValueAsUnsigned()
            if ptr_addr:
                byte_data = process.ReadMemory(ptr_addr, bytes_to_read, error)
                if error.Success():
                    # Properly decode UTF16LE to string
                    string_val = byte_data.decode('utf-16le', errors='replace')
                else:
                    return '[utf16] <read error: %s>' % error
            else:
                return '[utf16] <null ptr>'
        
        # Escape special characters
        string_val = string_val.replace('\\', '\\\\')
        string_val = string_val.replace('"', '\\"')
        string_val = string_val.replace('\n', '\\n')
        string_val = string_val.replace('\r', '\\r')
        string_val = string_val.replace('\t', '\\t')
        
        # Truncate display if too long
        display_truncated = truncated or len(string_val) > MAX_DISPLAY_CHARS
        if len(string_val) > MAX_DISPLAY_CHARS:
            string_val = string_val[:MAX_DISPLAY_CHARS]
        
        # Add encoding and size info at the beginning
        encoding = 'latin1' if is_8bit else 'utf16'
        
        if display_truncated:
            size_info = ' %d chars' % m_length
            if total_bytes >= 1024 * 1024:
                size_info += ' (%.1fMB)' % (total_bytes / (1024.0 * 1024.0))
            elif total_bytes >= 1024:
                size_info += ' (%.1fKB)' % (total_bytes / 1024.0)
            return '[%s%s] "%s..." <truncated>' % (encoding, size_info, string_val)
        else:
            return '[%s] "%s"' % (encoding, string_val)
    except:
        return '<error>'

def ZigString_SummaryProvider(value, _=None):
    try:
        value = value.GetNonSyntheticValue()
        
        ptr = value.GetChildMemberWithName('_unsafe_ptr_do_not_use').GetValueAsUnsigned()
        length = value.GetChildMemberWithName('len').GetValueAsUnsigned()
        
        # Check encoding flags
        is_16bit = (ptr & (1 << 63)) != 0
        is_utf8 = (ptr & (1 << 61)) != 0
        is_global = (ptr & (1 << 62)) != 0
        
        # Determine encoding
        encoding = 'utf16' if is_16bit else ('utf8' if is_utf8 else 'latin1')
        flags = ' global' if is_global else ''
        
        if length == 0:
            return '[%s%s] ""' % (encoding, flags)
        
        # Untag the pointer (keep only the lower 53 bits)
        untagged_ptr = ptr & ((1 << 53) - 1)
        
        # Limit memory reads to 1MB for performance
        MAX_BYTES = 1024 * 1024  # 1MB
        MAX_DISPLAY_CHARS = 200  # Maximum characters to display
        
        # Calculate how much to read
        bytes_per_char = 2 if is_16bit else 1
        total_bytes = length * bytes_per_char
        truncated = False
        
        if total_bytes > MAX_BYTES:
            # Read only first part of very large strings
            chars_to_read = MAX_BYTES // bytes_per_char
            bytes_to_read = chars_to_read * bytes_per_char
            truncated = True
        else:
            bytes_to_read = total_bytes
        
        # Read the string data
        process = value.process
        error = lldb.SBError()
        
        byte_data = process.ReadMemory(untagged_ptr, bytes_to_read, error)
        if not error.Success():
            return '[%s%s] <read error>' % (encoding, flags)
        
        # Decode based on encoding
        if is_16bit:
            string_val = byte_data.decode('utf-16le', errors='replace')
        elif is_utf8:
            string_val = byte_data.decode('utf-8', errors='replace')
        else:
            string_val = byte_data.decode('latin1', errors='replace')
        
        # Escape special characters
        string_val = string_val.replace('\\', '\\\\')
        string_val = string_val.replace('"', '\\"')
        string_val = string_val.replace('\n', '\\n')
        string_val = string_val.replace('\r', '\\r')
        string_val = string_val.replace('\t', '\\t')
        
        # Truncate display if too long
        display_truncated = truncated or len(string_val) > MAX_DISPLAY_CHARS
        if len(string_val) > MAX_DISPLAY_CHARS:
            string_val = string_val[:MAX_DISPLAY_CHARS]
        
        # Build the output
        if display_truncated:
            size_info = ' %d chars' % length
            if total_bytes >= 1024 * 1024:
                size_info += ' (%.1fMB)' % (total_bytes / (1024.0 * 1024.0))
            elif total_bytes >= 1024:
                size_info += ' (%.1fKB)' % (total_bytes / 1024.0)
            return '[%s%s%s] "%s..." <truncated>' % (encoding, flags, size_info, string_val)
        else:
            return '[%s%s] "%s"' % (encoding, flags, string_val)
    except:
        return '<error>'

def bun_String_SummaryProvider(value, _=None):
    try:
        value = value.GetNonSyntheticValue()
        
        # Debug: Show the actual type name LLDB sees
        type_name = value.GetTypeName()
        
        tag = value.GetChildMemberWithName('tag')
        if not tag or not tag.IsValid():
            # Try alternate field names
            tag = value.GetChildMemberWithName('Tag')
            if not tag or not tag.IsValid():
                # Show type name to help debug
                return '<no tag field in type: %s>' % type_name
        
        tag_value = tag.GetValueAsUnsigned()
        
        # Map tag values to names
        tag_names = {
            0: 'Dead',
            1: 'WTFStringImpl', 
            2: 'ZigString',
            3: 'StaticZigString',
            4: 'Empty'
        }
        
        tag_name = tag_names.get(tag_value, 'Unknown')
        
        if tag_name == 'Empty':
            return '""'
        elif tag_name == 'Dead':
            return '<dead>'
        elif tag_name == 'WTFStringImpl':
            value_union = value.GetChildMemberWithName('value')
            if not value_union or not value_union.IsValid():
                return '<no value field>'
            impl_value = value_union.GetChildMemberWithName('WTFStringImpl')
            if not impl_value or not impl_value.IsValid():
                return '<no WTFStringImpl field>'
            return WTFStringImpl_SummaryProvider(impl_value, _)
        elif tag_name == 'ZigString' or tag_name == 'StaticZigString':
            value_union = value.GetChildMemberWithName('value')
            if not value_union or not value_union.IsValid():
                return '<no value field>'
            field_name = 'ZigString' if tag_name == 'ZigString' else 'StaticZigString'
            zig_string_value = value_union.GetChildMemberWithName(field_name)
            if not zig_string_value or not zig_string_value.IsValid():
                return '<no %s field>' % field_name
            result = ZigString_SummaryProvider(zig_string_value, _)
            # Add static marker if needed
            if tag_name == 'StaticZigString':
                result = result.replace(']', ' static]')
            return result
        else:
            return '<unknown tag %d>' % tag_value
    except Exception as e:
        return '<error: %s>' % str(e)

def __lldb_init_module(debugger, _=None):
    # Initialize Bun Category
    debugger.HandleCommand('type category define --language c99 bun')
    
    # Initialize Bun Data Structures
    add(debugger, category='bun', regex=True, type='^baby_list\\.BabyList\\(.*\\)$', identifier='bun_BabyList', synth=True, expand=True, summary=True)
    
    # Add WTFStringImpl pretty printer - try multiple possible type names
    add(debugger, category='bun', type='WTFStringImpl', identifier='WTFStringImpl', summary=True)
    add(debugger, category='bun', type='*WTFStringImplStruct', identifier='WTFStringImpl', summary=True)
    add(debugger, category='bun', type='string.WTFStringImpl', identifier='WTFStringImpl', summary=True)
    add(debugger, category='bun', type='string.WTFStringImplStruct', identifier='WTFStringImpl', summary=True)
    add(debugger, category='bun', type='*string.WTFStringImplStruct', identifier='WTFStringImpl', summary=True)
    
    # Add ZigString pretty printer - try multiple possible type names
    add(debugger, category='bun', type='ZigString', identifier='ZigString', summary=True)
    add(debugger, category='bun', type='bun.js.bindings.ZigString', identifier='ZigString', summary=True)
    add(debugger, category='bun', type='bindings.ZigString', identifier='ZigString', summary=True)
    
    # Add bun.String pretty printer - try multiple possible type names
    add(debugger, category='bun', type='String', identifier='bun_String', summary=True)
    add(debugger, category='bun', type='bun.String', identifier='bun_String', summary=True)
    add(debugger, category='bun', type='string.String', identifier='bun_String', summary=True)
    add(debugger, category='bun', type='BunString', identifier='bun_String', summary=True)
    add(debugger, category='bun', type='bun::String', identifier='bun_String', summary=True)
    add(debugger, category='bun', type='bun::string::String', identifier='bun_String', summary=True)
    
    # Try regex patterns for more flexible matching
    add(debugger, category='bun', regex=True, type='.*String$', identifier='bun_String', summary=True)
    add(debugger, category='bun', regex=True, type='.*WTFStringImpl.*', identifier='WTFStringImpl', summary=True)
    add(debugger, category='bun', regex=True, type='.*ZigString.*', identifier='ZigString', summary=True)
    
    # Enable the category
    debugger.HandleCommand('type category enable bun')
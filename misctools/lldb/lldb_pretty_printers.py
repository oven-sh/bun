# https://github.com/ziglang/zig/blob/master/tools/lldb_pretty_printers.py

# pretty printing for the zig language, zig standard library, and zig stage 2 compiler.
# put commands in ~/.lldbinit to run them automatically when starting lldb
# `command script import /path/to/zig/tools/lldb_pretty_printers.py` to import this file
# `type category enable zig.lang` to enable pretty printing for the zig language
# `type category enable zig.std` to enable pretty printing for the zig standard library
# `type category enable zig.stage2` to enable pretty printing for the zig stage 2 compiler
import lldb
import re

page_size = 1 << 12

def log2_int(i): return i.bit_length() - 1

# Define Zig Language

zig_keywords = {
    'addrspace',
    'align',
    'allowzero',
    'and',
    'anyframe',
    'anytype',
    'asm',
    'async',
    'await',
    'break',
    'callconv',
    'catch',
    'comptime',
    'const',
    'continue',
    'defer',
    'else',
    'enum',
    'errdefer',
    'error',
    'export',
    'extern',
    'fn',
    'for',
    'if',
    'inline',
    'noalias',
    'noinline',
    'nosuspend',
    'opaque',
    'or',
    'orelse',
    'packed',
    'pub',
    'resume',
    'return',
    'linksection',
    'struct',
    'suspend',
    'switch',
    'test',
    'threadlocal',
    'try',
    'union',
    'unreachable',
    'usingnamespace',
    'var',
    'volatile',
    'while',
}
zig_primitives = {
    'anyerror',
    'anyframe',
    'anyopaque',
    'bool',
    'c_int',
    'c_long',
    'c_longdouble',
    'c_longlong',
    'c_short',
    'c_uint',
    'c_ulong',
    'c_ulonglong',
    'c_ushort',
    'comptime_float',
    'comptime_int',
    'f128',
    'f16',
    'f32',
    'f64',
    'f80',
    'false',
    'isize',
    'noreturn',
    'null',
    'true',
    'type',
    'undefined',
    'usize',
    'void',
}
zig_integer_type = re.compile('[iu][1-9][0-9]+')
zig_identifier_regex = re.compile('[A-Z_a-z][0-9A-Z_a-z]*')
def zig_IsVariableName(string): return string != '_' and string not in zig_keywords and string not in zig_primitives and not zig_integer_type.fullmatch(string) and zig_identifier_regex.fullmatch(string)
def zig_IsFieldName(string): return string not in zig_keywords and zig_identifier_regex.fullmatch(string)

class zig_Slice_SynthProvider:
    def __init__(self, value, _=None): self.value = value
    def update(self):
        try:
            self.ptr = self.value.GetChildMemberWithName('ptr')
            self.len = self.value.GetChildMemberWithName('len').unsigned if self.ptr.unsigned > page_size else 0
            self.elem_type = self.ptr.type.GetPointeeType()
            self.elem_size = self.elem_type.size
        except: pass
    def has_children(self): return True
    def num_children(self): return self.len or 0
    def get_child_index(self, name):
        try: return int(name.removeprefix('[').removesuffix(']'))
        except: return -1
    def get_child_at_index(self, index):
        if index not in range(self.len): return None
        try: return self.ptr.CreateChildAtOffset('[%d]' % index, index * self.elem_size, self.elem_type)
        except: return None

def zig_String_decode(value, offset=0, length=None):
    try:
        value = value.GetNonSyntheticValue()
        data = value.GetChildMemberWithName('ptr').GetPointeeData(offset, length if length is not None else value.GetChildMemberWithName('len').unsigned)
        b = bytes(data.uint8)
        b = b.replace(b'\\', b'\\\\')
        b = b.replace(b'\n', b'\\n')
        b = b.replace(b'\r', b'\\r')
        b = b.replace(b'\t', b'\\t')
        b = b.replace(b'"', b'\\"')
        b = b.replace(b'\'', b'\\\'')
        s = b.decode(encoding='ascii', errors='backslashreplace')
        return s if s.isprintable() else ''.join((c if c.isprintable() else '\\x%02x' % ord(c) for c in s))
    except: return None
def zig_String_SummaryProvider(value, _=None): return '"%s"' % zig_String_decode(value)
def zig_String_AsIdentifier(value, pred):
    string = zig_String_decode(value)
    return string if pred(string) else '@"%s"' % string

class zig_Optional_SynthProvider:
    def __init__(self, value, _=None): self.value = value
    def update(self):
        try:
            self.child = self.value.GetChildMemberWithName('some').unsigned == 1 and self.value.GetChildMemberWithName('data').Clone('child')
        except: pass
    def has_children(self): return bool(self.child)
    def num_children(self): return int(self.child)
    def get_child_index(self, name): return 0 if self.child and (name == 'child' or name == '?') else -1
    def get_child_at_index(self, index): return self.child if self.child and index == 0 else None
def zig_Optional_SummaryProvider(value, _=None):
    child = value.GetChildMemberWithName('child')
    return child or 'null'

class zig_ErrorUnion_SynthProvider:
    def __init__(self, value, _=None): self.value = value
    def update(self):
        try:
            self.error_set = self.value.GetChildMemberWithName('tag').Clone('error_set')
            self.payload = self.value.GetChildMemberWithName('value').Clone('payload') if self.error_set.unsigned == 0 else None
        except: pass
    def has_children(self): return True
    def num_children(self): return 1
    def get_child_index(self, name): return 0 if name == ('payload' if self.payload else 'error_set') else -1
    def get_child_at_index(self, index): return self.payload or self.error_set if index == 0 else None

class zig_TaggedUnion_SynthProvider:
    def __init__(self, value, _=None): self.value = value
    def update(self):
        try:
            self.tag = self.value.GetChildMemberWithName('tag')
            self.payload = self.value.GetChildMemberWithName('payload').GetChildMemberWithName(self.tag.value)
        except: pass
    def has_children(self): return True
    def num_children(self): return 1 + (self.payload is not None)
    def get_child_index(self, name):
        try: return ('tag', 'payload').index(name)
        except: return -1
    def get_child_at_index(self, index): return (self.tag, self.payload)[index] if index in range(2) else None

# Define Zig Standard Library

class std_SegmentedList_SynthProvider:
    def __init__(self, value, _=None): self.value = value
    def update(self):
        try:
            self.prealloc_segment = self.value.GetChildMemberWithName('prealloc_segment')
            self.dynamic_segments = zig_Slice_SynthProvider(self.value.GetChildMemberWithName('dynamic_segments'))
            self.dynamic_segments.update()
            self.len = self.value.GetChildMemberWithName('len').unsigned
        except: pass
    def has_children(self): return True
    def num_children(self): return self.len
    def get_child_index(self, name):
        try: return int(name.removeprefix('[').removesuffix(']'))
        except: return -1
    def get_child_at_index(self, index):
        try:
            if index not in range(self.len): return None
            prealloc_item_count = len(self.prealloc_segment)
            if index < prealloc_item_count: return self.prealloc_segment.child[index]
            prealloc_exp = prealloc_item_count.bit_length() - 1
            shelf_index = log2_int(index + 1) if prealloc_item_count == 0 else log2_int(index + prealloc_item_count) - prealloc_exp - 1
            shelf = self.dynamic_segments.get_child_at_index(shelf_index)
            box_index = (index + 1) - (1 << shelf_index) if prealloc_item_count == 0 else index + prealloc_item_count - (1 << ((prealloc_exp + 1) + shelf_index))
            elem_type = shelf.type.GetPointeeType()
            return shelf.CreateChildAtOffset('[%d]' % index, box_index * elem_type.size, elem_type)
        except: return None

class std_MultiArrayList_SynthProvider:
    def __init__(self, value, _=None): self.value = value
    def update(self):
        try:
            self.len = 0

            value_type = self.value.type
            for helper in self.value.target.FindFunctions('%s.dbHelper' % value_type.name, lldb.eFunctionNameTypeFull):
                ptr_self_type, ptr_child_type, ptr_field_type, ptr_entry_type = helper.function.type.GetFunctionArgumentTypes()
                if ptr_self_type.GetPointeeType() == value_type: break
            else: return

            self.entry_type = ptr_entry_type.GetPointeeType()
            self.bytes = self.value.GetChildMemberWithName('bytes')
            self.len = self.value.GetChildMemberWithName('len').unsigned
            self.capacity = self.value.GetChildMemberWithName('capacity').unsigned
        except: pass
    def has_children(self): return True
    def num_children(self): return self.len
    def get_child_index(self, name):
        try: return int(name.removeprefix('[').removesuffix(']'))
        except: return -1
    def get_child_at_index(self, index):
        try:
            if index not in range(self.len): return None
            offset = 0
            data = lldb.SBData()
            for field in self.entry_type.fields:
                field_type = field.type.GetPointeeType()
                field_size = field_type.size
                data.Append(self.bytes.CreateChildAtOffset(field.name, offset + index * field_size, field_type).address_of.data)
                offset += self.capacity * field_size
            return self.bytes.CreateValueFromData('[%d]' % index, data, self.entry_type)
        except: return None
class std_MultiArrayList_Slice_SynthProvider:
    def __init__(self, value, _=None): self.value = value
    def update(self):
        try:
            self.len = 0

            value_type = self.value.type
            for helper in self.value.target.FindFunctions('%s.dbHelper' % value_type.name, lldb.eFunctionNameTypeFull):
                ptr_self_type, ptr_child_type, ptr_field_type, ptr_entry_type = helper.function.type.GetFunctionArgumentTypes()
                if ptr_self_type.GetPointeeType() == value_type: break
            else: return

            self.fields = {member.name: index for index, member in enumerate(ptr_field_type.GetPointeeType().enum_members)}
            self.entry_type = ptr_entry_type.GetPointeeType()
            self.ptrs = self.value.GetChildMemberWithName('ptrs')
            self.len = self.value.GetChildMemberWithName('len').unsigned
            self.capacity = self.value.GetChildMemberWithName('capacity').unsigned
        except: pass
    def has_children(self): return True
    def num_children(self): return self.len
    def get_child_index(self, name):
        try: return int(name.removeprefix('[').removesuffix(']'))
        except: return -1
    def get_child_at_index(self, index):
        try:
            if index not in range(self.len): return None
            data = lldb.SBData()
            for field in self.entry_type.fields:
                field_type = field.type.GetPointeeType()
                data.Append(self.ptrs.child[self.fields[field.name.removesuffix('_ptr')]].CreateChildAtOffset(field.name, index * field_type.size, field_type).address_of.data)
            return self.ptrs.CreateValueFromData('[%d]' % index, data, self.entry_type)
        except: return None

class std_HashMapUnmanaged_SynthProvider:
    def __init__(self, value, _=None): self.value = value
    def update(self):
        try:
            self.capacity = 0
            self.indices = tuple()

            self.metadata = self.value.GetChildMemberWithName('metadata')
            if not self.metadata.unsigned: return

            value_type = self.value.type
            for helper in self.value.target.FindFunctions('%s.dbHelper' % value_type.name, lldb.eFunctionNameTypeFull):
                ptr_self_type, ptr_hdr_type, ptr_entry_type = helper.function.type.GetFunctionArgumentTypes()
                if ptr_self_type.GetPointeeType() == value_type: break
            else: return
            self.entry_type = ptr_entry_type.GetPointeeType()

            hdr_type = ptr_hdr_type.GetPointeeType()
            hdr = self.metadata.CreateValueFromAddress('header', self.metadata.deref.load_addr - hdr_type.size, hdr_type)
            self.values = hdr.GetChildMemberWithName('values')
            self.keys = hdr.GetChildMemberWithName('keys')
            self.capacity = hdr.GetChildMemberWithName('capacity').unsigned

            self.indices = tuple(i for i, value in enumerate(self.metadata.GetPointeeData(0, self.capacity).sint8) if value < 0)
        except: pass
    def has_children(self): return True
    def num_children(self): return len(self.indices)
    def get_capacity(self): return self.capacity
    def get_child_index(self, name):
        try: return int(name.removeprefix('[').removesuffix(']'))
        except: return -1
    def get_child_at_index(self, index):
        try:
            fields = {name: base.CreateChildAtOffset(name, self.indices[index] * pointee_type.size, pointee_type).address_of.data for name, base, pointee_type in ((name, base, base.type.GetPointeeType()) for name, base in (('key_ptr', self.keys), ('value_ptr', self.values)))}
            data = lldb.SBData()
            for field in self.entry_type.fields: data.Append(fields[field.name])
            return self.metadata.CreateValueFromData('[%d]' % index, data, self.entry_type)
        except: return None
def std_HashMapUnmanaged_SummaryProvider(value, _=None):
    synth = std_HashMapUnmanaged_SynthProvider(value.GetNonSyntheticValue(), _)
    synth.update()
    return 'len=%d capacity=%d' % (synth.num_children(), synth.get_capacity())

# formats a struct of fields of the form `name_ptr: *Type` by auto dereferencing its fields
class std_Entry_SynthProvider:
    def __init__(self, value, _=None): self.value = value
    def update(self):
        try:
            self.children = tuple(child.Clone(child.name.removesuffix('_ptr')) for child in self.value.children if child.type.GetPointeeType().size != 0)
            self.indices = {child.name: i for i, child in enumerate(self.children)}
        except: pass
    def has_children(self): return self.num_children() != 0
    def num_children(self): return len(self.children)
    def get_child_index(self, name): return self.indices.get(name)
    def get_child_at_index(self, index): return self.children[index].deref if index in range(len(self.children)) else None

# Define Zig Stage2 Compiler

class TagAndPayload_SynthProvider:
    def __init__(self, value, _=None): self.value = value
    def update(self):
        try:
            self.tag = self.value.GetChildMemberWithName('tag') or self.value.GetChildMemberWithName('tag_ptr').deref.Clone('tag')
            data = self.value.GetChildMemberWithName('data_ptr') or self.value.GetChildMemberWithName('data')
            self.payload = data.GetChildMemberWithName('payload').GetChildMemberWithName(data.GetChildMemberWithName('tag').value)
        except: pass
    def has_children(self): return True
    def num_children(self): return 2
    def get_child_index(self, name):
        try: return ('tag', 'payload').index(name)
        except: return -1
    def get_child_at_index(self, index): return (self.tag, self.payload)[index] if index in range(2) else None

def InstRef_SummaryProvider(value, _=None):
    return value if any(value.unsigned == member.unsigned for member in value.type.enum_members) else (
        'InternPool.Index(%d)' % value.unsigned if value.unsigned < 0x80000000 else 'instructions[%d]' % (value.unsigned - 0x80000000))

def InstIndex_SummaryProvider(value, _=None):
    return 'instructions[%d]' % value.unsigned

class zig_DeclIndex_SynthProvider:
    def __init__(self, value, _=None): self.value = value
    def update(self):
        try:
            ip = InternPool_Find(self.value.thread)
            if not ip: return
            self.ptr = ip.GetChildMemberWithName('allocated_decls').GetChildAtIndex(self.value.unsigned).address_of.Clone('decl')
        except: pass
    def has_children(self): return True
    def num_children(self): return 1
    def get_child_index(self, name): return 0 if name == 'decl' else -1
    def get_child_at_index(self, index): return self.ptr if index == 0 else None

class Module_Namespace__Module_Namespace_Index_SynthProvider:
    def __init__(self, value, _=None): self.value = value
    def update(self):
        try:
            ip = InternPool_Find(self.value.thread)
            if not ip: return
            self.ptr = ip.GetChildMemberWithName('allocated_namespaces').GetChildAtIndex(self.value.unsigned).address_of.Clone('namespace')
        except: pass
    def has_children(self): return True
    def num_children(self): return 1
    def get_child_index(self, name): return 0 if name == 'namespace' else -1
    def get_child_at_index(self, index): return self.ptr if index == 0 else None

class TagOrPayloadPtr_SynthProvider:
    def __init__(self, value, _=None): self.value = value
    def update(self):
        try:
            value_type = self.value.type
            for helper in self.value.target.FindFunctions('%s.dbHelper' % value_type.name, lldb.eFunctionNameTypeFull):
                ptr_self_type, ptr_tag_to_payload_map_type = helper.function.type.GetFunctionArgumentTypes()
                self_type = ptr_self_type.GetPointeeType()
                if self_type == value_type: break
            else: return
            tag_to_payload_map = {field.name: field.type for field in ptr_tag_to_payload_map_type.GetPointeeType().fields}

            tag = self.value.GetChildMemberWithName('tag_if_small_enough')
            if tag.unsigned < page_size:
                self.tag = tag.Clone('tag')
                self.payload = None
            else:
                ptr_otherwise = self.value.GetChildMemberWithName('ptr_otherwise')
                self.tag = ptr_otherwise.GetChildMemberWithName('tag')
                self.payload = ptr_otherwise.Cast(tag_to_payload_map[self.tag.value]).GetChildMemberWithName('data').Clone('payload')
        except: pass
    def has_children(self): return True
    def num_children(self): return 1 + (self.payload is not None)
    def get_child_index(self, name):
        try: return ('tag', 'payload').index(name)
        except: return -1
    def get_child_at_index(self, index): return (self.tag, self.payload)[index] if index in range(2) else None

def Module_Decl_name(decl):
    error = lldb.SBError()
    return decl.process.ReadCStringFromMemory(decl.GetChildMemberWithName('name').deref.load_addr, 256, error)

def Module_Namespace_RenderFullyQualifiedName(namespace):
    parent = namespace.GetChildMemberWithName('parent')
    if parent.unsigned < page_size: return zig_String_decode(namespace.GetChildMemberWithName('file_scope').GetChildMemberWithName('sub_file_path')).removesuffix('.zig').replace('/', '.')
    return '.'.join((Module_Namespace_RenderFullyQualifiedName(parent), Module_Decl_name(namespace.GetChildMemberWithName('ty').GetChildMemberWithName('payload').GetChildMemberWithName('owner_decl').GetChildMemberWithName('decl'))))

def Module_Decl_RenderFullyQualifiedName(decl): return '.'.join((Module_Namespace_RenderFullyQualifiedName(decl.GetChildMemberWithName('src_namespace')), Module_Decl_name(decl)))

def OwnerDecl_RenderFullyQualifiedName(payload): return Module_Decl_RenderFullyQualifiedName(payload.GetChildMemberWithName('owner_decl').GetChildMemberWithName('decl'))

def InternPool_Find(thread):
    for frame in thread:
        ip = frame.FindVariable('ip') or frame.FindVariable('intern_pool')
        if ip: return ip
        mod = frame.FindVariable('zcu') or frame.FindVariable('mod') or frame.FindVariable('module')
        if mod:
            ip = mod.GetChildMemberWithName('intern_pool')
            if ip: return ip

class InternPool_Index_SynthProvider:
    def __init__(self, value, _=None): self.value = value
    def update(self):
        try:
            index_type = self.value.type
            for helper in self.value.target.FindFunctions('%s.dbHelper' % index_type.name, lldb.eFunctionNameTypeFull):
                ptr_self_type, ptr_tag_to_encoding_map_type = helper.function.type.GetFunctionArgumentTypes()
                if ptr_self_type.GetPointeeType() == index_type: break
            else: return
            tag_to_encoding_map = {field.name: field.type for field in ptr_tag_to_encoding_map_type.GetPointeeType().fields}

            ip = InternPool_Find(self.value.thread)
            if not ip: return
            self.item = ip.GetChildMemberWithName('items').GetChildAtIndex(self.value.unsigned)
            extra = ip.GetChildMemberWithName('extra').GetChildMemberWithName('items')
            self.tag = self.item.GetChildMemberWithName('tag').Clone('tag')
            self.data = None
            self.trailing = None
            data = self.item.GetChildMemberWithName('data')
            encoding_type = tag_to_encoding_map[self.tag.value]
            dynamic_values = {}
            for encoding_field in encoding_type.fields:
                if encoding_field.name == 'data':
                    if encoding_field.type.IsPointerType():
                        extra_index = data.unsigned
                        self.data = extra.GetChildAtIndex(extra_index).address_of.Cast(encoding_field.type).deref.Clone('data')
                        extra_index += encoding_field.type.GetPointeeType().num_fields
                    else:
                        self.data = data.Cast(encoding_field.type).Clone('data')
                elif encoding_field.name == 'trailing':
                    trailing_data = lldb.SBData()
                    for trailing_field in encoding_field.type.fields:
                        trailing_data.Append(extra.GetChildAtIndex(extra_index).address_of.data)
                        trailing_len = dynamic_values['trailing.%s.len' % trailing_field.name].unsigned
                        trailing_data.Append(lldb.SBData.CreateDataFromInt(trailing_len, trailing_data.GetAddressByteSize()))
                        extra_index += trailing_len
                    self.trailing = self.data.CreateValueFromData('trailing', trailing_data, encoding_field.type)
                else:
                    for path in encoding_field.type.GetPointeeType().name.removeprefix('%s::' % encoding_type.name).removeprefix('%s.' % encoding_type.name).partition('__')[0].split(' orelse '):
                        if path.startswith('data.'):
                            root = self.data
                            path = path[len('data'):]
                        else: return
                        dynamic_value = root.GetValueForExpressionPath(path)
                        if dynamic_value:
                            dynamic_values[encoding_field.name] = dynamic_value
                            break
        except: pass
    def has_children(self): return True
    def num_children(self): return 2 + (self.trailing is not None)
    def get_child_index(self, name):
        try: return ('tag', 'data', 'trailing').index(name)
        except: return -1
    def get_child_at_index(self, index): return (self.tag, self.data, self.trailing)[index] if index in range(3) else None

def InternPool_NullTerminatedString_SummaryProvider(value, _=None):
    try:
        ip = InternPool_Find(value.thread)
        if not ip: return
        items = ip.GetChildMemberWithName('string_bytes').GetChildMemberWithName('items')
        b = bytearray()
        i = 0
        while True:
            x = items.GetChildAtIndex(value.unsigned + i).GetValueAsUnsigned()
            if x == 0: break
            b.append(x)
            i += 1
        s = b.decode(encoding='utf8', errors='backslashreplace')
        s1 = s if s.isprintable() else ''.join((c if c.isprintable() else '\\x%02x' % ord(c) for c in s))
        return '"%s"' % s1
    except:
        pass

def type_Type_pointer(payload):
    pointee_type = payload.GetChildMemberWithName('pointee_type')
    sentinel = payload.GetChildMemberWithName('sentinel').GetChildMemberWithName('child')
    align = payload.GetChildMemberWithName('align').unsigned
    addrspace = payload.GetChildMemberWithName('addrspace').value
    bit_offset = payload.GetChildMemberWithName('bit_offset').unsigned
    host_size = payload.GetChildMemberWithName('host_size').unsigned
    vector_index = payload.GetChildMemberWithName('vector_index')
    allowzero = payload.GetChildMemberWithName('allowzero').unsigned
    const = not payload.GetChildMemberWithName('mutable').unsigned
    volatile = payload.GetChildMemberWithName('volatile').unsigned
    size = payload.GetChildMemberWithName('size').value

    if size == 'One': summary = '*'
    elif size == 'Many': summary = '[*'
    elif size == 'Slice': summary = '['
    elif size == 'C': summary = '[*c'
    if sentinel: summary += ':%s' % value_Value_SummaryProvider(sentinel)
    if size != 'One': summary += ']'
    if allowzero: summary += 'allowzero '
    if align != 0 or host_size != 0 or vector_index.value != 'none': summary += 'align(%d%s%s) ' % (align, ':%d:%d' % (bit_offset, host_size) if bit_offset != 0 or host_size != 0 else '', ':?' if vector_index.value == 'runtime' else ':%d' % vector_index.unsigned if vector_index.value != 'none' else '')
    if addrspace != 'generic': summary += 'addrspace(.%s) ' % addrspace
    if const: summary += 'const '
    if volatile: summary += 'volatile '
    summary += type_Type_SummaryProvider(pointee_type)
    return summary

def type_Type_function(payload):
    param_types = payload.GetChildMemberWithName('param_types').children
    comptime_params = payload.GetChildMemberWithName('comptime_params').GetPointeeData(0, len(param_types)).uint8
    return_type = payload.GetChildMemberWithName('return_type')
    alignment = payload.GetChildMemberWithName('alignment').unsigned
    noalias_bits = payload.GetChildMemberWithName('noalias_bits').unsigned
    cc = payload.GetChildMemberWithName('cc').value
    is_var_args = payload.GetChildMemberWithName('is_var_args').unsigned

    return 'fn(%s)%s%s %s' % (', '.join(tuple(''.join(('comptime ' if comptime_param else '', 'noalias ' if noalias_bits & 1 << i else '', type_Type_SummaryProvider(param_type))) for i, (comptime_param, param_type) in enumerate(zip(comptime_params, param_types))) + (('...',) if is_var_args else ())), ' align(%d)' % alignment if alignment != 0 else '', ' callconv(.%s)' % cc if cc != 'Unspecified' else '', type_Type_SummaryProvider(return_type))

def type_Type_SummaryProvider(value, _=None):
    tag = value.GetChildMemberWithName('tag').value
    return type_tag_handlers.get(tag, lambda payload: tag)(value.GetChildMemberWithName('payload'))

type_tag_handlers = {
    'atomic_order': lambda payload: 'std.builtin.AtomicOrder',
    'atomic_rmw_op': lambda payload: 'std.builtin.AtomicRmwOp',
    'calling_convention': lambda payload: 'std.builtin.CallingConvention',
    'address_space': lambda payload: 'std.builtin.AddressSpace',
    'float_mode': lambda payload: 'std.builtin.FloatMode',
    'reduce_op': lambda payload: 'std.builtin.ReduceOp',
    'modifier': lambda payload: 'std.builtin.CallModifier',
    'prefetch_options': lambda payload: 'std.builtin.PrefetchOptions',
    'export_options': lambda payload: 'std.builtin.ExportOptions',
    'extern_options': lambda payload: 'std.builtin.ExternOptions',
    'type_info': lambda payload: 'std.builtin.Type',

    'enum_literal': lambda payload: '@TypeOf(.enum_literal)',
    'null': lambda payload: '@TypeOf(null)',
    'undefined': lambda payload: '@TypeOf(undefined)',
    'empty_struct_literal': lambda payload: '@TypeOf(.{})',

    'anyerror_void_error_union': lambda payload: 'anyerror!void',
    'slice_const_u8': lambda payload: '[]const u8',
    'slice_const_u8_sentinel_0': lambda payload: '[:0]const u8',
    'fn_noreturn_no_args': lambda payload: 'fn() noreturn',
    'fn_void_no_args': lambda payload: 'fn() void',
    'fn_naked_noreturn_no_args': lambda payload: 'fn() callconv(.Naked) noreturn',
    'fn_ccc_void_no_args': lambda payload: 'fn() callconv(.C) void',
    'single_const_pointer_to_comptime_int': lambda payload: '*const comptime_int',
    'manyptr_u8': lambda payload: '[*]u8',
    'manyptr_const_u8': lambda payload: '[*]const u8',
    'manyptr_const_u8_sentinel_0': lambda payload: '[*:0]const u8',

    'function': type_Type_function,
    'error_union': lambda payload: '%s!%s' % (type_Type_SummaryProvider(payload.GetChildMemberWithName('error_set')), type_Type_SummaryProvider(payload.GetChildMemberWithName('payload'))),
    'array_u8': lambda payload: '[%d]u8' % payload.unsigned,
    'array_u8_sentinel_0': lambda payload: '[%d:0]u8' % payload.unsigned,
    'vector': lambda payload: '@Vector(%d, %s)' % (payload.GetChildMemberWithName('len').unsigned, type_Type_SummaryProvider(payload.GetChildMemberWithName('elem_type'))),
    'array': lambda payload: '[%d]%s' % (payload.GetChildMemberWithName('len').unsigned, type_Type_SummaryProvider(payload.GetChildMemberWithName('elem_type'))),
    'array_sentinel': lambda payload: '[%d:%s]%s' % (payload.GetChildMemberWithName('len').unsigned, value_Value_SummaryProvider(payload.GetChildMemberWithName('sentinel')), type_Type_SummaryProvider(payload.GetChildMemberWithName('elem_type'))),
    'tuple': lambda payload: 'tuple{%s}' % ', '.join(('comptime %%s = %s' % value_Value_SummaryProvider(value) if value.GetChildMemberWithName('tag').value != 'unreachable_value' else '%s') % type_Type_SummaryProvider(type) for type, value in zip(payload.GetChildMemberWithName('types').children, payload.GetChildMemberWithName('values').children)),
    'anon_struct': lambda payload: 'struct{%s}' % ', '.join(('comptime %%s: %%s = %s' % value_Value_SummaryProvider(value) if value.GetChildMemberWithName('tag').value != 'unreachable_value' else '%s: %s') % (zig_String_AsIdentifier(name, zig_IsFieldName), type_Type_SummaryProvider(type)) for name, type, value in zip(payload.GetChildMemberWithName('names').children, payload.GetChildMemberWithName('types').children, payload.GetChildMemberWithName('values').children)),
    'pointer': type_Type_pointer,
    'single_const_pointer': lambda payload: '*const %s' % type_Type_SummaryProvider(payload),
    'single_mut_pointer': lambda payload: '*%s' % type_Type_SummaryProvider(payload),
    'many_const_pointer': lambda payload: '[*]const %s' % type_Type_SummaryProvider(payload),
    'many_mut_pointer': lambda payload: '[*]%s' % type_Type_SummaryProvider(payload),
    'c_const_pointer': lambda payload: '[*c]const %s' % type_Type_SummaryProvider(payload),
    'c_mut_pointer': lambda payload: '[*c]%s' % type_Type_SummaryProvider(payload),
    'slice_const': lambda payload: '[]const %s' % type_Type_SummaryProvider(payload),
    'mut_slice': lambda payload: '[]%s' % type_Type_SummaryProvider(payload),
    'int_signed': lambda payload: 'i%d' % payload.unsigned,
    'int_unsigned': lambda payload: 'u%d' % payload.unsigned,
    'optional': lambda payload: '?%s' % type_Type_SummaryProvider(payload),
    'optional_single_mut_pointer': lambda payload: '?*%s' % type_Type_SummaryProvider(payload),
    'optional_single_const_pointer': lambda payload: '?*const %s' % type_Type_SummaryProvider(payload),
    'anyframe_T': lambda payload: 'anyframe->%s' % type_Type_SummaryProvider(payload),
    'error_set': lambda payload: type_tag_handlers['error_set_merged'](payload.GetChildMemberWithName('names')),
    'error_set_single': lambda payload: 'error{%s}' % zig_String_AsIdentifier(payload, zig_IsFieldName),
    'error_set_merged': lambda payload: 'error{%s}' % ','.join(zig_String_AsIdentifier(child.GetChildMemberWithName('key'), zig_IsFieldName) for child in payload.GetChildMemberWithName('entries').children),
    'error_set_inferred': lambda payload: '@typeInfo(@typeInfo(@TypeOf(%s)).@"fn".return_type.?).error_union.error_set' % OwnerDecl_RenderFullyQualifiedName(payload.GetChildMemberWithName('func')),

    'enum_full': OwnerDecl_RenderFullyQualifiedName,
    'enum_nonexhaustive': OwnerDecl_RenderFullyQualifiedName,
    'enum_numbered': OwnerDecl_RenderFullyQualifiedName,
    'enum_simple': OwnerDecl_RenderFullyQualifiedName,
    'struct': OwnerDecl_RenderFullyQualifiedName,
    'union': OwnerDecl_RenderFullyQualifiedName,
    'union_safety_tagged': OwnerDecl_RenderFullyQualifiedName,
    'union_tagged': OwnerDecl_RenderFullyQualifiedName,
    'opaque': OwnerDecl_RenderFullyQualifiedName,
}

def value_Value_str_lit(payload):
    for frame in payload.thread:
        mod = frame.FindVariable('zcu') or frame.FindVariable('mod') or frame.FindVariable('module')
        if mod: break
    else: return
    return '"%s"' % zig_String_decode(mod.GetChildMemberWithName('string_literal_bytes').GetChildMemberWithName('items'), payload.GetChildMemberWithName('index').unsigned, payload.GetChildMemberWithName('len').unsigned)

def value_Value_SummaryProvider(value, _=None):
    tag = value.GetChildMemberWithName('tag').value
    return value_tag_handlers.get(tag, lambda payload: tag.removesuffix('_type'))(value.GetChildMemberWithName('payload'))

value_tag_handlers = {
    'undef': lambda payload: 'undefined',
    'zero': lambda payload: '0',
    'one': lambda payload: '1',
    'void_value': lambda payload: '{}',
    'unreachable_value': lambda payload: 'unreachable',
    'null_value': lambda payload: 'null',
    'bool_true': lambda payload: 'true',
    'bool_false': lambda payload: 'false',

    'empty_struct_value': lambda payload: '.{}',
    'empty_array': lambda payload: '.{}',

    'ty': type_Type_SummaryProvider,
    'int_type': lambda payload: '%c%d' % (payload.GetChildMemberWithName('bits').unsigned, 's' if payload.GetChildMemberWithName('signed').unsigned == 1 else 'u'),
    'int_u64': lambda payload: '%d' % payload.unsigned,
    'int_i64': lambda payload: '%d' % payload.signed,
    'int_big_positive': lambda payload: sum(child.unsigned << i * child.type.size * 8 for i, child in enumerate(payload.children)),
    'int_big_negative': lambda payload: '-%s' % value_tag_handlers['int_big_positive'](payload),
    'function': OwnerDecl_RenderFullyQualifiedName,
    'extern_fn': OwnerDecl_RenderFullyQualifiedName,
    'variable': lambda payload: value_Value_SummaryProvider(payload.GetChildMemberWithName('decl').GetChildMemberWithName('val')),
    'runtime_value': value_Value_SummaryProvider,
    'decl_ref': lambda payload: value_Value_SummaryProvider(payload.GetChildMemberWithName('decl').GetChildMemberWithName('val')),
    'decl_ref_mut': lambda payload: value_Value_SummaryProvider(payload.GetChildMemberWithName('decl_index').GetChildMemberWithName('decl').GetChildMemberWithName('val')),
    'comptime_field_ptr': lambda payload: '&%s' % value_Value_SummaryProvider(payload.GetChildMemberWithName('field_val')),
    'elem_ptr': lambda payload: '(%s)[%d]' % (value_Value_SummaryProvider(payload.GetChildMemberWithName('array_ptr')), payload.GetChildMemberWithName('index').unsigned),
    'field_ptr': lambda payload: '(%s).field[%d]' % (value_Value_SummaryProvider(payload.GetChildMemberWithName('container_ptr')), payload.GetChildMemberWithName('field_index').unsigned),
    'bytes': lambda payload: '"%s"' % zig_String_decode(payload),
    'str_lit': value_Value_str_lit,
    'repeated': lambda payload: '.{%s} ** _' % value_Value_SummaryProvider(payload),
    'empty_array_sentinel': lambda payload: '.{%s}' % value_Value_SummaryProvider(payload),
    'slice': lambda payload: '(%s)[0..%s]' % tuple(value_Value_SummaryProvider(payload.GetChildMemberWithName(name)) for name in ('ptr', 'len')),
    'float_16': lambda payload: payload.value,
    'float_32': lambda payload: payload.value,
    'float_64': lambda payload: payload.value,
    'float_80': lambda payload: payload.value,
    'float_128': lambda payload: payload.value,
    'enum_literal': lambda payload: '.%s' % zig_String_AsIdentifier(payload, zig_IsFieldName),
    'enum_field_index': lambda payload: 'field[%d]' % payload.unsigned,
    'error': lambda payload: 'error.%s' % zig_String_AsIdentifier(payload.GetChildMemberWithName('name'), zig_IsFieldName),
    'eu_payload': value_Value_SummaryProvider,
    'eu_payload_ptr': lambda payload: '&((%s).* catch unreachable)' % value_Value_SummaryProvider(payload.GetChildMemberWithName('container_ptr')),
    'opt_payload': value_Value_SummaryProvider,
    'opt_payload_ptr': lambda payload: '&(%s).*.?' % value_Value_SummaryProvider(payload.GetChildMemberWithName('container_ptr')),
    'aggregate': lambda payload: '.{%s}' % ', '.join(map(value_Value_SummaryProvider, payload.children)),
    'union': lambda payload: '.{.%s = %s}' % tuple(value_Value_SummaryProvider(payload.GetChildMemberWithName(name)) for name in ('tag', 'val')),

    'lazy_align': lambda payload: '@alignOf(%s)' % type_Type_SummaryProvider(payload),
    'lazy_size': lambda payload: '@sizeOf(%s)' % type_Type_SummaryProvider(payload),
}

# Initialize

def add(debugger, *, category, regex=False, type, identifier=None, synth=False, inline_children=False, expand=False, summary=False):
    prefix = '.'.join((__name__, (identifier or type).replace('.', '_').replace(':', '_')))
    if summary: debugger.HandleCommand('type summary add --category %s%s%s "%s"' % (category, ' --inline-children' if inline_children else ''.join((' --expand' if expand else '', ' --python-function %s_SummaryProvider' % prefix if summary == True else ' --summary-string "%s"' % summary)), ' --regex' if regex else '', type))
    if synth: debugger.HandleCommand('type synthetic add --category %s%s --python-class %s_SynthProvider "%s"' % (category, ' --regex' if regex else '', prefix, type))

def MultiArrayList_Entry(type): return '^multi_array_list\\.MultiArrayList\\(%s\\)\\.Entry__struct_[1-9][0-9]*$' % type

def __lldb_init_module(debugger, _=None):
    # Initialize Zig Categories
    debugger.HandleCommand('type category define --language c99 zig.lang zig.std')

    # Initialize Zig Language
    add(debugger, category='zig.lang', regex=True, type='^\\[\\]', identifier='zig_Slice', synth=True, expand=True, summary='len=${svar%#}')
    add(debugger, category='zig.lang', type='[]u8', identifier='zig_String', summary=True)
    add(debugger, category='zig.lang', regex=True, type='^\\?', identifier='zig_Optional', synth=True, summary=True)
    add(debugger, category='zig.lang', regex=True, type='^(error{.*}|anyerror)!', identifier='zig_ErrorUnion', synth=True, inline_children=True, summary=True)

    # Initialize Zig Standard Library
    add(debugger, category='zig.std', type='mem.Allocator', summary='${var.ptr}')
    add(debugger, category='zig.std', regex=True, type='^segmented_list\\.SegmentedList\\(.*\\)$', identifier='std_SegmentedList', synth=True, expand=True, summary='len=${var.len}')
    add(debugger, category='zig.std', regex=True, type='^multi_array_list\\.MultiArrayList\\(.*\\)$', identifier='std_MultiArrayList', synth=True, expand=True, summary='len=${var.len} capacity=${var.capacity}')
    add(debugger, category='zig.std', regex=True, type='^multi_array_list\\.MultiArrayList\\(.*\\)\\.Slice$', identifier='std_MultiArrayList_Slice', synth=True, expand=True, summary='len=${var.len} capacity=${var.capacity}')
    add(debugger, category='zig.std', regex=True, type=MultiArrayList_Entry('.*'), identifier='std_Entry', synth=True, inline_children=True, summary=True)
    add(debugger, category='zig.std', regex=True, type='^hash_map\\.HashMapUnmanaged\\(.*\\)$', identifier='std_HashMapUnmanaged', synth=True, expand=True, summary=True)
    add(debugger, category='zig.std', regex=True, type='^hash_map\\.HashMapUnmanaged\\(.*\\)\\.Entry$', identifier = 'std_Entry', synth=True, inline_children=True, summary=True)

    # Initialize Zig Stage2 Compiler
    add(debugger, category='zig.stage2', type='Zir.Inst', identifier='TagAndPayload', synth=True, inline_children=True, summary=True)
    add(debugger, category='zig.stage2', regex=True, type=MultiArrayList_Entry('Zir\\.Inst'), identifier='TagAndPayload', synth=True, inline_children=True, summary=True)
    add(debugger, category='zig.stage2', regex=True, type='^Zir\\.Inst\\.Data\\.Data__struct_[1-9][0-9]*$', inline_children=True, summary=True)
    add(debugger, category='zig.stage2', type='Zir.Inst::Zir.Inst.Ref', identifier='InstRef', summary=True)
    add(debugger, category='zig.stage2', type='Zir.Inst::Zir.Inst.Index', identifier='InstIndex', summary=True)
    add(debugger, category='zig.stage2', type='Air.Inst', identifier='TagAndPayload', synth=True, inline_children=True, summary=True)
    add(debugger, category='zig.stage2', type='Air.Inst::Air.Inst.Ref', identifier='InstRef', summary=True)
    add(debugger, category='zig.stage2', type='Air.Inst::Air.Inst.Index', identifier='InstIndex', summary=True)
    add(debugger, category='zig.stage2', regex=True, type=MultiArrayList_Entry('Air\\.Inst'), identifier='TagAndPayload', synth=True, inline_children=True, summary=True)
    add(debugger, category='zig.stage2', regex=True, type='^Air\\.Inst\\.Data\\.Data__struct_[1-9][0-9]*$', inline_children=True, summary=True)
    add(debugger, category='zig.stage2', type='zig.DeclIndex', synth=True)
    add(debugger, category='zig.stage2', type='Module.Namespace::Module.Namespace.Index', synth=True)
    add(debugger, category='zig.stage2', type='Module.LazySrcLoc', identifier='zig_TaggedUnion', synth=True)
    add(debugger, category='zig.stage2', type='InternPool.Index', synth=True)
    add(debugger, category='zig.stage2', type='InternPool.NullTerminatedString', summary=True)
    add(debugger, category='zig.stage2', type='InternPool.Key', identifier='zig_TaggedUnion', synth=True)
    add(debugger, category='zig.stage2', type='InternPool.Key.Int.Storage', identifier='zig_TaggedUnion', synth=True)
    add(debugger, category='zig.stage2', type='InternPool.Key.ErrorUnion.Value', identifier='zig_TaggedUnion', synth=True)
    add(debugger, category='zig.stage2', type='InternPool.Key.Float.Storage', identifier='zig_TaggedUnion', synth=True)
    add(debugger, category='zig.stage2', type='InternPool.Key.Ptr.Addr', identifier='zig_TaggedUnion', synth=True)
    add(debugger, category='zig.stage2', type='InternPool.Key.Aggregate.Storage', identifier='zig_TaggedUnion', synth=True)
    add(debugger, category='zig.stage2', type='arch.x86_64.CodeGen.MCValue', identifier='zig_TaggedUnion', synth=True, inline_children=True, summary=True)

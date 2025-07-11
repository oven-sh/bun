# Pretty printers for Bun data structures
import lldb
import re

class bun_BabyList_SynthProvider:
    def __init__(self, value, _=None): 
        self.value = value
        
    def update(self):
        try:
            self.ptr = self.value.GetChildMemberWithName('ptr')
            self.len = self.value.GetChildMemberWithName('len').unsigned
            self.cap = self.value.GetChildMemberWithName('cap').unsigned
            self.elem_type = self.ptr.type.GetPointeeType()
            self.elem_size = self.elem_type.size
        except:
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
        return 'len=%d cap=%d' % (len_val.unsigned, cap_val.unsigned)
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

def __lldb_init_module(debugger, _=None):
    # Initialize Bun Category
    debugger.HandleCommand('type category define --language c99 bun')
    
    # Initialize Bun Data Structures
    add(debugger, category='bun', regex=True, type='^baby_list\\.BabyList\\(.*\\)$', identifier='bun_BabyList', synth=True, expand=True, summary=True)
    
    # Enable the category
    debugger.HandleCommand('type category enable bun')
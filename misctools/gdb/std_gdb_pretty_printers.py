# pretty printing for the standard library.
# put "source /path/to/stage2_gdb_pretty_printers.py" in ~/.gdbinit to load it automatically.
import re
import gdb.printing

# Handles both ArrayList and ArrayListUnmanaged.
class ArrayListPrinter:
    def __init__(self, val):
        self.val = val

    def to_string(self):
        type = self.val.type.name[len('std.array_list.'):]
        type = re.sub(r'^ArrayListAligned(Unmanaged)?\((.*),null\)$', r'ArrayList\1(\2)', type)
        return '%s of length %s, capacity %s' % (type, self.val['items']['len'], self.val['capacity'])

    def children(self):
        for i in range(self.val['items']['len']):
            item = self.val['items']['ptr'] + i
            yield ('[%d]' % i, item.dereference())

    def display_hint(self):
        return 'array'

class MultiArrayListPrinter:
    def __init__(self, val):
        self.val = val

    def child_type(self):
        (helper_fn, _) = gdb.lookup_symbol('%s.dbHelper' % self.val.type.name)
        return helper_fn.type.fields()[1].type.target()

    def to_string(self):
        type = self.val.type.name[len('std.multi_array_list.'):]
        return '%s of length %s, capacity %s' % (type, self.val['len'], self.val['capacity'])

    def slice(self):
        fields = self.child_type().fields()
        base = self.val['bytes']
        cap = self.val['capacity']
        len = self.val['len']

        if len == 0:
            return

        fields = sorted(fields, key=lambda field: field.type.alignof, reverse=True)

        for field in fields:
            ptr = base.cast(field.type.pointer()).dereference().cast(field.type.array(len - 1))
            base += field.type.sizeof * cap
            yield (field.name, ptr)

    def children(self):
        for i, (name, ptr) in enumerate(self.slice()):
            yield ('[%d]' % i, name)
            yield ('[%d]' % i, ptr)

    def display_hint(self):
        return 'map'

# Handles both HashMap and HashMapUnmanaged.
class HashMapPrinter:
    def __init__(self, val):
        self.type = val.type
        is_managed = re.search(r'^std\.hash_map\.HashMap\(', self.type.name)
        self.val = val['unmanaged'] if is_managed else val

    def header_ptr_type(self):
        (helper_fn, _) = gdb.lookup_symbol('%s.dbHelper' % self.val.type.name)
        return helper_fn.type.fields()[1].type

    def header(self):
        if self.val['metadata'] == 0:
            return None
        return (self.val['metadata'].cast(self.header_ptr_type()) - 1).dereference()

    def to_string(self):
        type = self.type.name[len('std.hash_map.'):]
        type = re.sub(r'^HashMap(Unmanaged)?\((.*),std.hash_map.AutoContext\(.*$', r'AutoHashMap\1(\2)', type)
        hdr = self.header()
        if hdr is not None:
            cap = hdr['capacity']
        else:
            cap = 0
        return '%s of length %s, capacity %s' % (type, self.val['size'], cap)

    def children(self):
        hdr = self.header()
        if hdr is None:
            return
        is_map = self.display_hint() == 'map'
        for i in range(hdr['capacity']):
            metadata = self.val['metadata'] + i
            if metadata.dereference()['used'] == 1:
                yield ('[%d]' % i, (hdr['keys'] + i).dereference())
                if is_map:
                    yield ('[%d]' % i, (hdr['values'] + i).dereference())

    def display_hint(self):
        for field in self.header_ptr_type().target().fields():
            if field.name == 'values':
                return 'map'
        return 'array'

# Handles both ArrayHashMap and ArrayHashMapUnmanaged.
class ArrayHashMapPrinter:
    def __init__(self, val):
        self.type = val.type
        is_managed = re.search(r'^std\.array_hash_map\.ArrayHashMap\(', self.type.name)
        self.val = val['unmanaged'] if is_managed else val

    def to_string(self):
        type = self.type.name[len('std.array_hash_map.'):]
        type = re.sub(r'^ArrayHashMap(Unmanaged)?\((.*),std.array_hash_map.AutoContext\(.*$', r'AutoArrayHashMap\1(\2)', type)
        return '%s of length %s' % (type, self.val['entries']['len'])

    def children(self):
        entries = MultiArrayListPrinter(self.val['entries'])
        len = self.val['entries']['len']
        fields = {}
        for name, ptr in entries.slice():
            fields[str(name)] = ptr

        for i in range(len):
            if 'key' in fields:
                yield ('[%d]' % i, fields['key'][i])
            else:
                yield ('[%d]' % i, '{}')
            if 'value' in fields:
                yield ('[%d]' % i, fields['value'][i])

    def display_hint(self):
        for name, ptr in MultiArrayListPrinter(self.val['entries']).slice():
            if name == 'value':
                return 'map'
        return 'array'

pp = gdb.printing.RegexpCollectionPrettyPrinter('Zig standard library')
pp.add_printer('ArrayList', r'^std\.array_list\.ArrayListAligned(Unmanaged)?\(.*\)$', ArrayListPrinter)
pp.add_printer('MultiArrayList', r'^std\.multi_array_list\.MultiArrayList\(.*\)$', MultiArrayListPrinter)
pp.add_printer('HashMap', r'^std\.hash_map\.HashMap(Unmanaged)?\(.*\)$', HashMapPrinter)
pp.add_printer('ArrayHashMap', r'^std\.array_hash_map\.ArrayHashMap(Unmanaged)?\(.*\)$', ArrayHashMapPrinter)
gdb.printing.register_pretty_printer(gdb.current_objfile(), pp)

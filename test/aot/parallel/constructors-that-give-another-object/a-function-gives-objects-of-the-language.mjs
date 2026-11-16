// Maps, Sets, dates, errors, views, lists, functions, proxies and literals in place of the object that was made.
function Holder(kind) {
  switch (kind) {
    case 'map': return new Map([[1, 2]]);
    case 'set': return new Set([1, 2]);
    case 'date': return new Date(0);
    case 'error': return new Error('given');
    case 'bytes': return new Uint8Array([1, 2, 3]);
    case 'list': return [1, 2, 3, 4];
    case 'function': return function given() {};
    case 'literal': return { kind: 'literal', size: 9 };
    case 'nothing': return Object.create(null);
    case 'proxy': return new Proxy({ kind: 'proxy' }, {});
  }
  this.kind = kind;
  this.size = kind.length;
}
for (const kind of JSON.parse('["plain","map","set","date","error","bytes","list","function","literal","nothing","proxy","again"]')) {
  const it = new Holder(kind);
  console.log(kind, it.kind, it.size, it.length, it instanceof Holder);
}

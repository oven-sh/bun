// Members of Bun that nothing names: the object goes to a timer as an argument and comes back as a value nobody knows; each member is taken out of its own values under a name put together at run time, and used.
// That Bun is in unknown hands is no use of its members. Every name is there. A member in native code works; one written in JavaScript is in the executable only for a program that names it, and throws an error that says so. The expected output is written down.
// Alone: what it prints depends on what else the executable holds: which modules and members were compiled in, and whether anything evaluates text
const never = process.argv.length > 99;
const glue = (...parts) => parts.join(never ? "x" : "");
setTimeout(async u => {
  {
  let r; try { const f = Object.entries(u).find(([k]) => k === glue('$', ''))?.[1]; r = f === undefined ? "absent" : String((await f`echo hi`.text()).trim()); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.$', r);
  }
  {
  let r; try { const f = ({ ...u })[glue('p', 'eek')]; r = f === undefined ? "absent" : String(f(Promise.resolve(5))); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.peek', r);
  }
  {
  let r; try { const f = Object.assign({}, u)[glue('r', 'eadableStreamToText')]; r = f === undefined ? "absent" : String(await f(new Response('abc').body)); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.readableStreamToText', r);
  }
  {
  let r; try { const f = Object.entries(u).find(([k]) => k === glue('r', 'eadableStreamToArray'))?.[1]; r = f === undefined ? "absent" : String((await f(new Response('abc').body)).length); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.readableStreamToArray', r);
  }
  {
  let r; try { const f = ({ ...u })[glue('r', 'eadableStreamToJSON')]; r = f === undefined ? "absent" : String((await f(new Response('{"a":1}').body)).a); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.readableStreamToJSON', r);
  }
  {
  let r; try { const f = Object.assign({}, u)[glue('r', 'eadableStreamToBytes')]; r = f === undefined ? "absent" : String((await f(new Response('abc').body)).length); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.readableStreamToBytes', r);
  }
  {
  let r; try { const f = Object.entries(u).find(([k]) => k === glue('r', 'eadableStreamToBlob'))?.[1]; r = f === undefined ? "absent" : String((await f(new Response('abc').body)).size); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.readableStreamToBlob', r);
  }
  {
  let r; try { const f = ({ ...u })[glue('G', 'lob')]; r = f === undefined ? "absent" : String(new f('*.x').match('a.x')); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.Glob', r);
  }
  {
  let r; try { const f = Object.assign({}, u)[glue('s', 'emver')]; r = f === undefined ? "absent" : String(f.satisfies('1.2.3', '^1.0.0')); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.semver', r);
  }
  {
  let r; try { const f = Object.entries(u).find(([k]) => k === glue('T', 'OML'))?.[1]; r = f === undefined ? "absent" : String(f.parse('a = 1').a); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.TOML', r);
  }
  {
  let r; try { const f = ({ ...u })[glue('Y', 'AML')]; r = f === undefined ? "absent" : String(f.parse('a: 1').a); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.YAML', r);
  }
  {
  let r; try { const f = Object.assign({}, u)[glue('J', 'SON5')]; r = f === undefined ? "absent" : String(f.parse('{a:1}').a); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.JSON5', r);
  }
  {
  let r; try { const f = Object.entries(u).find(([k]) => k === glue('J', 'SONC'))?.[1]; r = f === undefined ? "absent" : String(f.parse('{"a":1}//c').a); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.JSONC', r);
  }
  {
  let r; try { const f = ({ ...u })[glue('h', 'ash')]; r = f === undefined ? "absent" : String(typeof f('a')); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.hash', r);
  }
  {
  let r; try { const f = Object.assign({}, u)[glue('C', 'ryptoHasher')]; r = f === undefined ? "absent" : String(new f('sha1').update('a').digest('hex').length); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.CryptoHasher', r);
  }
  {
  let r; try { const f = Object.entries(u).find(([k]) => k === glue('S', 'HA256'))?.[1]; r = f === undefined ? "absent" : String(f.hash('a', 'hex').length); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.SHA256', r);
  }
  {
  let r; try { const f = ({ ...u })[glue('d', 'eepEquals')]; r = f === undefined ? "absent" : String(f({ a: 1 }, { a: 1 })); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.deepEquals', r);
  }
  {
  let r; try { const f = Object.assign({}, u)[glue('d', 'eepMatch')]; r = f === undefined ? "absent" : String(f({ a: 1 }, { a: 1, b: 2 })); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.deepMatch', r);
  }
  {
  let r; try { const f = Object.entries(u).find(([k]) => k === glue('s', 'tringWidth'))?.[1]; r = f === undefined ? "absent" : String(f('abc')); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.stringWidth', r);
  }
  {
  let r; try { const f = ({ ...u })[glue('c', 'olor')]; r = f === undefined ? "absent" : String(f('red', 'hex')); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.color', r);
  }
  {
  let r; try { const f = Object.assign({}, u)[glue('r', 'andomUUIDv7')]; r = f === undefined ? "absent" : String(f().length); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.randomUUIDv7', r);
  }
  {
  let r; try { const f = Object.entries(u).find(([k]) => k === glue('n', 'anoseconds'))?.[1]; r = f === undefined ? "absent" : String(typeof f()); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.nanoseconds', r);
  }
  {
  let r; try { const f = ({ ...u })[glue('w', 'hich')]; r = f === undefined ? "absent" : String(typeof f('sh')); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.which', r);
  }
  {
  let r; try { const f = Object.assign({}, u)[glue('i', 'nspect')]; r = f === undefined ? "absent" : String(f({ a: 1 })); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.inspect', r);
  }
  {
  let r; try { const f = Object.entries(u).find(([k]) => k === glue('T', 'ranspiler'))?.[1]; r = f === undefined ? "absent" : String(new f({ loader: 'ts' }).transformSync('const a: number = 1; a').length > 0); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.Transpiler', r);
  }
  {
  let r; try { const f = ({ ...u })[glue('g', 'zipSync')]; r = f === undefined ? "absent" : String(f(new Uint8Array(4)).length > 0); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.gzipSync', r);
  }
  {
  let r; try { const f = Object.assign({}, u)[glue('z', 'stdCompressSync')]; r = f === undefined ? "absent" : String(f(new Uint8Array(4)).length > 0); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.zstdCompressSync', r);
  }
  {
  let r; try { const f = Object.entries(u).find(([k]) => k === glue('C', 'ookie'))?.[1]; r = f === undefined ? "absent" : String(new f('a', 'b').name); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.Cookie', r);
  }
  {
  let r; try { const f = ({ ...u })[glue('C', 'ookieMap')]; r = f === undefined ? "absent" : String(new f('a=b').get('a')); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.CookieMap', r);
  }
  {
  let r; try { const f = Object.assign({}, u)[glue('s', 'leep')]; r = f === undefined ? "absent" : String(await f(1)); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.sleep', r);
  }
  {
  let r; try { const f = Object.entries(u).find(([k]) => k === glue('f', 'ile'))?.[1]; r = f === undefined ? "absent" : String(typeof f('/etc/hostname').size); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.file', r);
  }
  {
  let r; try { const f = ({ ...u })[glue('s', 'pawnSync')]; r = f === undefined ? "absent" : String(f(['echo', 'hi']).stdout.toString().trim()); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.spawnSync', r);
  }
  {
  let r; try { const f = Object.assign({}, u)[glue('e', 'scapeHTML')]; r = f === undefined ? "absent" : String(f('<')); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.escapeHTML', r);
  }
  {
  let r; try { const f = Object.entries(u).find(([k]) => k === glue('f', 'ileURLToPath'))?.[1]; r = f === undefined ? "absent" : String(f(process.platform === "win32" ? 'file:///C:/a' : 'file:///a')).replace(/^C:\\/, "/"); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.fileURLToPath', r);
  }
  {
  let r; try { const f = ({ ...u })[glue('p', 'athToFileURL')]; r = f === undefined ? "absent" : String(f('/a').href); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.pathToFileURL', r);
  }
  {
  let r; try { const f = Object.assign({}, u)[glue('c', 'oncatArrayBuffers')]; r = f === undefined ? "absent" : String(f([new Uint8Array(1), new Uint8Array(2)]).byteLength); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.concatArrayBuffers', r);
  }
  {
  let r; try { const f = Object.entries(u).find(([k]) => k === glue('A', 'rrayBufferSink'))?.[1]; r = f === undefined ? "absent" : String((() => { const s = new f(); s.start(); s.write('ab'); return s.end().byteLength; })()); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.ArrayBufferSink', r);
  }
  {
  let r; try { const f = ({ ...u })[glue('p', 'assword')]; r = f === undefined ? "absent" : String(typeof f.hashSync('a')); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.password', r);
  }
  {
  let r; try { const f = Object.assign({}, u)[glue('d', 'ns')]; r = f === undefined ? "absent" : String(typeof f.lookup); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.dns', r);
  }
  {
  let r; try { const f = Object.entries(u).find(([k]) => k === glue('i', 'ndexOfLine'))?.[1]; r = f === undefined ? "absent" : String(f(new Uint8Array([1, 10, 2]), 0)); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.indexOfLine', r);
  }
  {
  let r; try { const f = ({ ...u })[glue('s', 'tripANSI')]; r = f === undefined ? "absent" : String(f('\u001b[1ma')); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.stripANSI', r);
  }
  {
  let r; try { const f = Object.assign({}, u)[glue('r', 'esolveSync')]; r = f === undefined ? "absent" : String(typeof f('node:fs', '/')); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.resolveSync', r);
  }
  {
  let r; try { const f = Object.entries(u).find(([k]) => k === glue('C', 'SRF'))?.[1]; r = f === undefined ? "absent" : String(typeof f.generate('s')); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.CSRF', r);
  }
  {
  let r; try { const f = ({ ...u })[glue('m', 'arkdown')]; r = f === undefined ? "absent" : String(typeof f); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.markdown', r);
  }
  {
  let r; try { const f = Object.assign({}, u)[glue('F', 'ileSystemRouter')]; r = f === undefined ? "absent" : String(typeof f); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.FileSystemRouter', r);
  }
  {
  let r; try { const f = ({ ...u })[glue('l', 'isten')]; r = f === undefined ? "absent" : String(typeof f); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.listen', r);
  }
  {
  let r; try { const f = Object.assign({}, u)[glue('m', 'map')]; r = f === undefined ? "absent" : String(typeof f); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.mmap', r);
  }
  {
  let r; try { const f = Object.entries(u).find(([k]) => k === glue('g', 'c'))?.[1]; r = f === undefined ? "absent" : String(typeof f(false)); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.gc', r);
  }
  {
  let r; try { const f = ({ ...u })[glue('g', 'enerateHeapSnapshot')]; r = f === undefined ? "absent" : String(typeof f); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.generateHeapSnapshot', r);
  }
  {
  let r; try { const f = Object.assign({}, u)[glue('s', 'hrink')]; r = f === undefined ? "absent" : String(f()); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.shrink', r);
  }
  {
  let r; try { const f = Object.entries(u).find(([k]) => k === glue('i', 'sMainThread'))?.[1]; r = f === undefined ? "absent" : String(f); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.isMainThread', r);
  }
  {
  let r; try { const f = ({ ...u })[glue('m', 'ain')]; r = f === undefined ? "absent" : String(typeof f); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.main', r);
  }
  {
  let r; try { const f = Object.assign({}, u)[glue('v', 'ersion')]; r = f === undefined ? "absent" : String(typeof f); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.version', r);
  }
  {
  let r; try { const f = Object.entries(u).find(([k]) => k === glue('e', 'nv'))?.[1]; r = f === undefined ? "absent" : String(typeof (f.PATH ?? f.Path /* TODO: on Windows PATH alone is undefined here; why is not known */)); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.env', r);
  }
  {
  let r; try { const f = ({ ...u })[glue('a', 'rgv')]; r = f === undefined ? "absent" : String(f.length > 0); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.argv', r);
  }
  {
  let r; try { const f = Object.assign({}, u)[glue('s', 'tdout')]; r = f === undefined ? "absent" : String(typeof f.size); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.stdout', r);
  }
  {
  let r; try { const f = Object.entries(u).find(([k]) => k === glue('s', '3'))?.[1]; r = f === undefined ? "absent" : String(typeof f); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.s3', r);
  }
  {
  let r; try { const f = ({ ...u })[glue('r', 'edis')]; r = f === undefined ? "absent" : String(typeof f); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.redis', r);
  }
  {
  let r; try { const f = Object.assign({}, u)[glue('s', 'ql')]; r = f === undefined ? "absent" : String(typeof f); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.sql', r);
  }
  {
  let r; try { const f = Object.entries(u).find(([k]) => k === glue('S', 'QL'))?.[1]; r = f === undefined ? "absent" : String(typeof f); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.SQL', r);
  }
  {
  let r; try { const f = ({ ...u })[glue('s', 'ecrets')]; r = f === undefined ? "absent" : String(typeof f); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.secrets', r);
  }
  {
  let r; try { const f = Object.assign({}, u)[glue('A', 'rchive')]; r = f === undefined ? "absent" : String(typeof f); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.Archive', r);
  }
  {
  let r; try { const f = Object.entries(u).find(([k]) => k === glue('I', 'mage'))?.[1]; r = f === undefined ? "absent" : String(typeof f); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.Image', r);
  }
  {
  let r; try { const f = ({ ...u })[glue('c', 'ron')]; r = f === undefined ? "absent" : String(typeof f); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.cron', r);
  }
  {
  let r; try { const f = Object.assign({}, u)[glue('e', 'mbeddedFiles')]; r = f === undefined ? "absent" : String(f.length); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Bun.embeddedFiles', r);
  }
}, 0, Bun);
/* Output:
Bun.$ threw Error: Bun.$ was not compiled into this executable because your code never uses it. To 
Bun.peek threw Error: Bun.peek was not compiled into this executable because your code never uses it. 
Bun.readableStreamToText abc
Bun.readableStreamToArray 1
Bun.readableStreamToJSON 1
Bun.readableStreamToBytes 3
Bun.readableStreamToBlob 3
Bun.Glob true
Bun.semver true
Bun.TOML 1
Bun.YAML 1
Bun.JSON5 1
Bun.JSONC 1
Bun.hash bigint
Bun.CryptoHasher 40
Bun.SHA256 64
Bun.deepEquals true
Bun.deepMatch true
Bun.stringWidth 3
Bun.color #ff0000
Bun.randomUUIDv7 36
Bun.nanoseconds number
Bun.which string
Bun.inspect {
  a: 1,
}
Bun.Transpiler true
Bun.gzipSync true
Bun.zstdCompressSync true
Bun.Cookie a
Bun.CookieMap b
Bun.sleep undefined
Bun.file number
Bun.spawnSync hi
Bun.escapeHTML &lt;
Bun.fileURLToPath /a
Bun.pathToFileURL file:///a
Bun.concatArrayBuffers 3
Bun.ArrayBufferSink 2
Bun.password string
Bun.dns function
Bun.indexOfLine 1
Bun.stripANSI a
Bun.resolveSync string
Bun.CSRF string
Bun.markdown object
Bun.FileSystemRouter function
Bun.listen function
Bun.mmap function
Bun.gc number
Bun.generateHeapSnapshot function
Bun.shrink undefined
Bun.isMainThread true
Bun.main string
Bun.version string
Bun.env string
Bun.argv true
Bun.stdout number
Bun.s3 object
Bun.redis object
Bun.sql function
Bun.SQL function
Bun.secrets object
Bun.Archive function
Bun.Image function
Bun.cron function
Bun.embeddedFiles 0
*/

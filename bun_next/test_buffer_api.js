const Buffer = require('buffer').Buffer;
const crypto = require('crypto');
const util = require('util');

console.log('--- Test 1: Buffer UTF-8 ---');
const buf1 = Buffer.from('Héllô Wôrld 🔥');
const str1 = buf1.toString('utf8');
console.log('UTF-8 String:', str1);
if (str1 === 'Héllô Wôrld 🔥') {
  console.log('✅ Test 1 Réussi');
} else {
  console.log('❌ Test 1 Échoué:', str1);
}

console.log('\n--- Test 2: Buffer Hex ---');
const hexStr = '48656c6c6f';
const buf2 = Buffer.from(hexStr, 'hex');
const str2 = buf2.toString('utf8');
const hexOut = buf2.toString('hex');
console.log('Hex Out:', hexOut, '| String:', str2);
if (str2 === 'Hello' && hexOut === hexStr) {
  console.log('✅ Test 2 Réussi');
} else {
  console.log('❌ Test 2 Échoué');
}

console.log('\n--- Test 3: Buffer Base64 ---');
const b64Str = 'SGVsbG8gV29ybGQ=';
const buf3 = Buffer.from(b64Str, 'base64');
const str3 = buf3.toString('utf8');
const b64Out = buf3.toString('base64');
console.log('Base64 Out:', b64Out, '| String:', str3);
if (str3 === 'Hello World' && b64Out === b64Str) {
  console.log('✅ Test 3 Réussi');
} else {
  console.log('❌ Test 3 Échoué');
}

console.log('\n--- Test 4: Buffer Concat ---');
const c1 = Buffer.from('Bun-');
const c2 = Buffer.from('Elixir');
const concated = Buffer.concat([c1, c2]);
const strConcat = concated.toString('utf8');
console.log('Concat String:', strConcat);
if (strConcat === 'Bun-Elixir' && concated.length === 10) {
  console.log('✅ Test 4 Réussi');
} else {
  console.log('❌ Test 4 Échoué');
}

console.log('\n--- Test 5: Crypto randomBytes & randomFillSync ---');
const rand = crypto.randomBytes(16);
console.log('rand constructor name:', rand && rand.constructor && rand.constructor.name);
console.log('Buffer constructor name:', Buffer.name);
console.log('rand instanceof Buffer:', rand instanceof Buffer);
console.log('rand instanceof Uint8Array:', rand instanceof Uint8Array);
console.log('randomBytes is Buffer:', Buffer.isBuffer(rand), '| Length:', rand.length);

const arr = new Uint8Array(8);
crypto.randomFillSync(arr);
console.log('randomFillSync filled:', arr);

let asyncRandPassed = false;
crypto.randomBytes(8, (err, bytes) => {
  if (!err && Buffer.isBuffer(bytes) && bytes.length === 8) {
    console.log('✅ Async randomBytes Réussi');
    asyncRandPassed = true;
  } else {
    console.log('❌ Async randomBytes Échoué', err);
  }
  runUtilTests();
});

function runUtilTests() {
  console.log('\n--- Test 6: Util inherits & types ---');
  
  function Parent() {}
  Parent.prototype.sayHello = function() { return 'Hello'; };
  function Child() {}
  util.inherits(Child, Parent);
  const child = new Child();
  console.log('Child inherits sayHello:', typeof child.sayHello === 'function' ? child.sayHello() : 'no');
  
  const isDate = util.types.isDate(new Date());
  const isRegExp = util.types.isRegExp(/abc/);
  const isPromise = util.types.isPromise(Promise.resolve());
  console.log('isDate:', isDate, '| isRegExp:', isRegExp, '| isPromise:', isPromise);
  
  if (child.sayHello() === 'Hello' && isDate && isRegExp && isPromise && asyncRandPassed) {
    console.log('✅ Test 6 & Global Réussi !');
    sendToElixir({ type: 'buffer_test_done', success: true });
  } else {
    console.log('❌ Test 6 ou Global Échoué');
    sendToElixir({ type: 'buffer_test_done', success: false });
  }
}

const stream = require('node:stream');
const Readable = stream.Readable;
const Writable = stream.Writable;
const Transform = stream.Transform;
const pipeline = stream.pipeline;

console.log('--- Test 1: Readable & Writable simple ---');
const r = new Readable({
  read() {
    this.push('A');
    this.push('B');
    this.push(null);
  }
});

let output = '';
const w = new Writable({
  write(chunk, encoding, callback) {
    output += chunk;
    callback();
  }
});

r.pipe(w);

w.on('finish', () => {
  console.log('Test 1 Output:', output);
  if (output === 'AB') {
    console.log('✅ Test 1 Réussi');
  } else {
    console.log('❌ Test 1 Échoué:', output);
  }
  runTest2();
});

function runTest2() {
  console.log('\n--- Test 2: Transform (Uppercase) & Pipeline ---');
  
  const r2 = new Readable({
    read() {
      this.push('hello ');
      this.push('world');
      this.push(null);
    }
  });
  
  const t = new Transform({
    transform(chunk, encoding, callback) {
      callback(null, chunk.toUpperCase());
    }
  });
  
  let output2 = '';
  const w2 = new Writable({
    write(chunk, encoding, callback) {
      output2 += chunk;
      callback();
    }
  });
  
  pipeline(r2, t, w2, (err) => {
    if (err) {
      console.log('❌ Test 2 Erreur:', err);
      sendToElixir({ type: 'stream_test_done', success: false });
    } else {
      console.log('Test 2 Output:', output2);
      if (output2 === 'HELLO WORLD') {
        console.log('✅ Test 2 Réussi');
        sendToElixir({ type: 'stream_test_done', success: true });
      } else {
        console.log('❌ Test 2 Échoué:', output2);
        sendToElixir({ type: 'stream_test_done', success: false });
      }
    }
  });
}

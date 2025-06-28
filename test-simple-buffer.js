const proc = Bun.spawn({
  cmd: ['echo', 'hello'],
  stdout: 'buffer'
});

console.log('1. Created process');
console.log('2. proc.stdout is Promise:', proc.stdout instanceof Promise);

const timeoutId = setTimeout(() => {
  console.log('TIMEOUT: Promise never resolved!');
  process.exit(1);
}, 2000);

proc.stdout.then(buffer => {
  clearTimeout(timeoutId);
  console.log('3. Promise resolved!');
  console.log('4. buffer:', buffer);
  console.log('5. buffer instanceof Buffer:', buffer instanceof Buffer);
  console.log('6. buffer.toString():', buffer.toString());
  console.log('SUCCESS');
  process.exit(0);
}).catch(err => {
  clearTimeout(timeoutId);
  console.log('ERROR:', err);
  process.exit(1);
});
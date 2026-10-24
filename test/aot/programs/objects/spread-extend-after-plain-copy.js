// A plain copy and an extending copy of one structure never share a cache entry, even when the extending site has the first request of the program.
function extend(o) { return { ...o, a: 1 }; }
function copy(o) { return { ...o }; }

const text = JSON.parse('"{\\"x\\":1}"');
for (let i = 0; i < 4; i++) {
  console.log(JSON.stringify(copy(JSON.parse(text))), JSON.stringify(extend(JSON.parse(text))));
}

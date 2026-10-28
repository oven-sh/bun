const seen = [];
const traps = new Proxy({}, {
  get: (handler, trap) => (...list) => {
    seen.push(trap + (typeof list[1] === "string" || typeof list[1] === "symbol" ? " " + String(list[1]) : ""));
    return Reflect[trap](...list);
  },
});

function refused(label, run) {
  seen.length = 0;
  try {
    run(new Proxy({}, traps));
    console.log(label, "returned");
  } catch (error) {
    console.log(label, error.constructor.name, error.code);
  }
  console.log(label, "asked:", seen.join(", "));
}

refused("Buffer.alloc", t => Buffer.alloc(t));
refused("readUInt8", t => Buffer.alloc(2).readUInt8(t));
refused("write", t => Buffer.alloc(2).write(t));
refused("indexOf", t => Buffer.alloc(2).indexOf(t));
refused("Buffer.concat", t => Buffer.concat([Buffer.alloc(1)], t));

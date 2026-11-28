// The text of a JSON.parse names the built-in modules that a require of an unknown name may ask for.
const load = [require][JSON.parse("0")];
const ask = name => {
  try {
    return typeof load(name);
  } catch (error) {
    return error.code;
  }
};
const list = JSON.parse(`["node:vm"]`);
const record = JSON.parse(`{ "node:v8": 1 }`);
console.log(ask(list[0]), ask(Object.keys(record)[0]), ask(JSON.parse(`{ "held": "zlib" }`).held));

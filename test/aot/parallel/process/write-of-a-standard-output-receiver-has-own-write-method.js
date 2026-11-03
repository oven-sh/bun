const seen = [];
const receiver = {
  _write(data, encoding, cb) {
    seen.push(String(data).trim());
    cb(null);
    return "mine";
  },
};
try {
  console.log(process.stdout.write.call(receiver, "x\n"), seen.join(), Object.getOwnPropertySymbols(receiver).length);
} catch (error) {
  console.log(error.name, error.message);
}

exports.pending = 3;
async function finish() {
  await null;
  exports.pending--;
}
finish();
finish();
finish();

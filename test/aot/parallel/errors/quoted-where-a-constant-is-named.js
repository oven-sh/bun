// `bun <file>` puts the value of a constant where its name stands, and quotes 'null.x' here.
function receiver() {
  const holder = null;
  return holder.x;
}
try {
  receiver();
} catch (error) {
  console.log(error.message);
}

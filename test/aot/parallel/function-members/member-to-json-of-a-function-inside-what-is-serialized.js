// JSON.stringify() finds the function in an object that it walks.
function K() {}
K.n = 1;
function bump() {
  return ++K.n;
}
bump();
K.toJSON = () => "json";
console.log(JSON.stringify({ k: K }), JSON.stringify([K]), JSON.stringify(K), bump());

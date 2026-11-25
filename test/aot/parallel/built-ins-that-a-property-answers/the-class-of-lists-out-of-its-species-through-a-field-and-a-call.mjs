function use(Maker) {
  return Maker.from("abcde").length;
}
const held = { maker: Array[Symbol.species] };
console.log(held.maker.from("abcd").length, use(Array[Symbol.species]));

var f =
  function (mod) {
    return mod && mod.__esModule ? mod : { "default": mod };
  } && JSON.parse("null");
let said = typeof f;
try {
  said += " " + JSON.stringify(f({ x: 1 }));
} catch (e) {
  said += " " + e.name;
}
console.log(said);

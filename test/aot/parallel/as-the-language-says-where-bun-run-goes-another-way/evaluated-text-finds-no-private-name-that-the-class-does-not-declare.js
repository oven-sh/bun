// compatibility.mdx, "Smaller differences". `bun run` keeps the value of the accessor field in a field that its transpiler names `#level_accessor_storage`, and evaluated text finds it: "1 1 true".
class Gauge {
  accessor #level = 1;
  ask(text) {
    try {
      return eval(text);
    } catch (error) {
      return error.name;
    }
  }
}
const gauge = new Gauge();
console.log(gauge.ask("this.#level"), gauge.ask("this.#level_accessor_storage"), gauge.ask("#level_accessor_storage in this"));
/* Output:
1 SyntaxError SyntaxError
*/

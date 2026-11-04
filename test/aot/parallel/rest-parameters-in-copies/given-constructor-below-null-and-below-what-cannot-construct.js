class Nothing extends null {}
const said = [];
for (let i = 0; i < 2; i++) {
  try { new Nothing(i); said.push("made"); } catch (error) { said.push(error.constructor.name); }
}
class Given extends Object {}
Object.setPrototypeOf(Given, () => {});
try { new Given(); said.push("made"); } catch (error) { said.push(error.constructor.name); }
console.log(said.join());

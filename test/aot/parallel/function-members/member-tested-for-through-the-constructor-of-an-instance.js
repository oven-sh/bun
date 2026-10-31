// Nothing writes the name of the function where it is tested.
function Made() {}
Made.n = 1;
Made.n++;
const made = new Made();
console.log("n" in made.constructor, made.constructor.hasOwnProperty("n"), Made.n);

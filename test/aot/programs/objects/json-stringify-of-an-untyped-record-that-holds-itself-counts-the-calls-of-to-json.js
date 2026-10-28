// An object that holds itself is given to JSON.stringify by a function that is called twice. It prints the error and how often toJSON has run.
let calls = 0;
const holder = {
  counter: {
    toJSON() {
      calls++;
      return 1;
    },
  },
  self: null,
};
holder.self = holder;
function write(value) {
  try {
    return JSON.stringify(value);
  } catch (error) {
    return String(error) + " " + calls;
  }
}
console.log(write(holder));
console.log(write(holder));
holder.self = [holder.counter];
console.log(write(holder), calls);

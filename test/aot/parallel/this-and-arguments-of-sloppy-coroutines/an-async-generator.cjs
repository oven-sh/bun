function sum() { let total = 0; for (let i = 0; i < arguments.length; i++) total += arguments[i]; return total; }
async function* relay() { yield sum.apply(null, arguments); }
relay(4, 5).next().then(step => console.log(step.value));

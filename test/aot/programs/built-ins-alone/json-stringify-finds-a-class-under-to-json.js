try {
  console.log(JSON.stringify({ a: 1, toJSON: class C {} }));
} catch (error) {
  console.log(error.constructor.name);
}

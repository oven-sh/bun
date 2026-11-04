for (const make of [() => Object.create(URL.prototype), () => ({ __proto__: URLSearchParams.prototype }), () => Object.setPrototypeOf({}, ReadableStream.prototype)]) {
  try { console.log(make()); } catch (error) { console.log(error.name, error.message); }
}

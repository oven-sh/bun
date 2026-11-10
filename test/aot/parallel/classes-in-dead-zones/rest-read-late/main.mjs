for (let i = 0; i < 2; i++) {
  try {
    const { B } = await import("./part.mjs");
    console.log(typeof B);
  } catch (error) {
    console.log(error.name);
  }
}

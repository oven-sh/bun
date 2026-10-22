try {
  process.binding("no-such-binding");
} catch (error) {
  console.log(error instanceof Error);
}

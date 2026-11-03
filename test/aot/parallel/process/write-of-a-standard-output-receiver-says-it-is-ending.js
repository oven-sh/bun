try {
  console.log(process.stdout.write.call({ _writableState: { ending: true } }, "x\n"));
} catch (error) {
  console.log(error.name, error.code, error.message);
}

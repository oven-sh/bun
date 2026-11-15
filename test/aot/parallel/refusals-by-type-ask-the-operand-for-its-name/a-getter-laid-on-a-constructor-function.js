// A function that is constructed names its instances too, and a program can lay a getter under `name`.
function Made() {}
Object.defineProperty(Made, "name", {
  get() {
    console.log("asked");
    return "Made";
  },
});
try {
  process.chdir(new Made());
} catch (error) {
  console.log(error.code, "|", error.message);
}

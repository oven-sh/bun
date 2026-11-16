// A class has a `name` of its own, so the getter of the class above it is not asked.
class Base {
  static get name() {
    console.log("asked");
    return "Base";
  }
}
class Made extends Base {}
try {
  process.umask(new Made());
} catch (error) {
  console.log(error.code, "|", error.message);
}
try {
  process.umask(new Base());
} catch (error) {
  console.log(error.code, "|", error.message);
}

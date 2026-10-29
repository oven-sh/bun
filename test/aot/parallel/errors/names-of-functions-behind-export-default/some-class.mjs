export default class {
  constructor() {
    this.place = new Error("here").stack
      .split("\n")[1]
      .trim()
      .replace(/\(.*[\/\\]/, "(");
  }
}

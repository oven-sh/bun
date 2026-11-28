export class Plain {
  hello() {
    return "real";
  }
}
export const config = {
  load() {
    return "loaded";
  },
};

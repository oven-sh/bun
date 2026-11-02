export class Loader {
  async load(path) {
    return { ...(await import(path)) };
  }
}

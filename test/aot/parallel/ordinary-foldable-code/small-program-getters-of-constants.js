const app = {
  name: "demo",
  version: [1, 4, 0],
  get versionText() {
    return this.version.join(".");
  },
  get banner() {
    return `${this.name}@${this.versionText}`;
  },
  get isStable() {
    return this.version[0] >= 1;
  },
};
console.log(app.banner, app.isStable, JSON.stringify(app));

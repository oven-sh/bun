class Config {
  constructor(text, name) {
    this.valid = false;
    try {
      this.data = JSON.parse(text);
      this.reload = () => 1;
      this.valid = true;
    } catch (e) {}
    this.name = name;
    this.label = name + ":" + text.length;
    this.created = text.length > 3 ? "long" : "short";
    this.retries = 0;
    this.limit = text.length * 2 + 1;
    this.tags = [name, this.created];
    this.summary = this.label + " " + this.tags.length + " " + this.limit;
  }
}
function describe(c) { return (c.valid ? "valid" : "invalid") + " " + typeof c.reload + " " + typeof c.data + " " + c.created; }
function main(text) { const c = new Config(text, "app"); console.log(describe(c)); }
main(process.argv[2] ?? "{");

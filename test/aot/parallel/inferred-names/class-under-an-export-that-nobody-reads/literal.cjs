module.exports = {
  kept: 2,
  unread: class {
    static told = console.log("in the literal:", JSON.stringify(this.name));
  },
};

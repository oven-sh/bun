export default {
  async fetch() {
    return fetch(
      "https://raw.githubusercontent.com/oven-sh/bun/HEAD/src/cli/install.sh"
    );
  },
};

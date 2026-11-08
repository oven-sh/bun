const allow = (options) => {
  const settings = { origin: "*", ...options };
  const find = ((chosen) => {
    if (typeof chosen === "string") {
      if (chosen === "*")
        return () => chosen;
      return (asked) => (chosen === asked ? asked : null);
    }
    if (typeof chosen === "function")
      return chosen;
    return (asked) => (chosen.includes(asked) ? asked : null);
  })(settings.origin);
  return (asked) => find(asked);
};
const listed = allow({ origin: ["here", "there"] });
console.log(listed("here"), listed("elsewhere"));

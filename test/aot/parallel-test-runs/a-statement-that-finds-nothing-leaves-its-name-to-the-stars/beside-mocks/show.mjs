export const show = (label, all) => console.log("| CASE", label, "|", Object.keys(all).join(), "|", String(all.paint), String(all.measure), "paint" in all, JSON.stringify({ ...all }));
export const say = async (label, load) => {
  try {
    show(label, await load());
  } catch (error) {
    console.log("| CASE", label, "|", error.name, String(error.message).replace(/'[^']*\/([^\/']+)'/g, "'$1'"));
  }
};

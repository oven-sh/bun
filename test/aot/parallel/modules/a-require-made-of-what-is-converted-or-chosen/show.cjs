exports.show = (label, f) => { let got; try { got = f(); } catch { got = "refused"; } console.log(label, got); };

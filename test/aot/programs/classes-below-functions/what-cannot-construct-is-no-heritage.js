const arrow = () => {}; async function later() {} function* many() {} const method = { m() {} }.m;
for (const [name, heritage] of [["arrow", arrow], ["async", later], ["generator", many], ["method", method]]) { try { class Fine extends heritage {} console.log(name, "defined"); } catch (error) { console.log(name, error.constructor.name); } }
try { class Fine extends later { extra = 1; } } catch (error) { console.log(error.constructor.name); }
try { class Fine extends many { extra = 1; } } catch (error) { console.log(error.constructor.name); }

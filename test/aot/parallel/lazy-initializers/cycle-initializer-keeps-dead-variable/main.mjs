// Two files import each other. A read that comes before the declaration has run throws where it stands.
// Alone: what is put off goes by all that the executable holds
try { const a = await import("./a.mjs"); console.log(a.later().held.title.text); } catch (e) { console.log(e.name + ": " + e.message); }

globalThis.ready();
try { await globalThis.gate; } catch (error) { console.log('waiter catches', error.message); }
console.log('waiter resumes'); await Promise.resolve(); console.log('waiter second'); await Promise.resolve(); console.log('waiter third');
console.log('w ends');

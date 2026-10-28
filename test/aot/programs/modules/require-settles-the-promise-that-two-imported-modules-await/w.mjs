try { await globalThis.gate; } catch (error) { console.log('waiter catches', error.message); }
console.log('waiter resumes');
console.log('w ends');

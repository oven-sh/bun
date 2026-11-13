console.log(performance.constructor.name, Object.getPrototypeOf(performance).constructor === Performance);
try { new performance.constructor(); console.log("made"); } catch (error) { console.log(error.name); }
try { performance.constructor(); console.log("called"); } catch (error) { console.log(error.name); }
console.log(crypto.subtle.constructor.name, crypto.constructor.name);
try { new crypto.subtle.constructor(); console.log("made"); } catch (error) { console.log(error.name); }

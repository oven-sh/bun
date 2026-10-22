const subject = [].values();
subject.constructor = 1.5;
console.log(typeof subject.constructor, subject.constructor + 1);

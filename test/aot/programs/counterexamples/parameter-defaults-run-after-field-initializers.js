// In a class that extends nothing the fields are initialized before the defaults of the constructor's parameters run.
new class { x = 1; constructor(a = this.x) { console.log(a); } };

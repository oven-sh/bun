class Named { static name = "a field"; static length = "another"; }
class Below extends Named {}
console.log(Named.name, Named.length, Below.name, Below.length);

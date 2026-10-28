// Twenty subclasses override one method, and a list of them is read by index between calls of that method. A second entry point requires a file whose name is only known at run time.
abstract class Animal {
  abstract sound(): string;
  twice(): string {
    return this.sound() + this.sound();
  }
}
class Ant extends Animal {
  sound(): string {
    return "ant";
  }
}
class Bee extends Animal {
  sound(): string {
    return "bee";
  }
}
class Cat extends Animal {
  sound(): string {
    return "cat";
  }
}
class Dog extends Animal {
  sound(): string {
    return "dog";
  }
}
class Eel extends Animal {
  sound(): string {
    return "eel";
  }
}
class Fox extends Animal {
  sound(): string {
    return "fox";
  }
}
class Gnu extends Animal {
  sound(): string {
    return "gnu";
  }
}
class Hen extends Animal {
  sound(): string {
    return "hen";
  }
}
class Ibis extends Animal {
  sound(): string {
    return "ibis";
  }
}
class Jay extends Animal {
  sound(): string {
    return "jay";
  }
}
class Koi extends Animal {
  sound(): string {
    return "koi";
  }
}
class Lynx extends Animal {
  sound(): string {
    return "lynx";
  }
}
class Mole extends Animal {
  sound(): string {
    return "mole";
  }
}
class Newt extends Animal {
  sound(): string {
    return "newt";
  }
}
class Owl extends Animal {
  sound(): string {
    return "owl";
  }
}
class Pig extends Animal {
  sound(): string {
    return "pig";
  }
}
class Quail extends Animal {
  sound(): string {
    return "quail";
  }
}
class Rat extends Animal {
  sound(): string {
    return "rat";
  }
}
class Seal extends Animal {
  sound(): string {
    return "seal";
  }
}
class Toad extends Animal {
  sound(): string {
    return "toad";
  }
}

const animals: Animal[] = [
  new Ant(),
  new Bee(),
  new Cat(),
  new Dog(),
  new Eel(),
  new Fox(),
  new Gnu(),
  new Hen(),
  new Ibis(),
  new Jay(),
  new Koi(),
  new Lynx(),
  new Mole(),
  new Newt(),
  new Owl(),
  new Pig(),
  new Quail(),
  new Rat(),
  new Seal(),
  new Toad(),
];

function soundOf(animal: Animal): string {
  return animal.sound();
}

function soundsOf(list: Animal[]): string {
  let text = "";
  for (const animal of list) text += animal.sound() + " ";
  return text;
}

function print(label: string): void {
  console.log(
    label +
      ": " +
      soundsOf(animals) +
      "| " +
      soundOf(animals[7]) +
      " " +
      soundOf(animals[19]) +
      " " +
      animals[7].twice() +
      " " +
      new Hen().sound(),
  );
}

let length = 0;
for (let i = 0; i < 2000; i++) length += soundOf(animals[i % 20]).length + animals[i % 20].twice().length;
console.log(length);
print("first");
print("second");
print("third");

export {};

export default {
  fetch(request: Request): Response {
    const animal = getAnimal(request.url);
    const voice = animal.talk();
    return new Response(voice);
  },
};

function getAnimal(query: string): Animal {
  switch (query.split("/").pop()) {
    case "dog":
      return new Dog();
    case "cat":
      return new Cat();
  }
  return new Bird();
}

interface Animal {
  readonly name: string;
  talk(): string;
}

class Dog implements Animal {
  name = "dog";

  talk(): string {
    return "woof";
  }
}

class Cat implements Animal {
  name = "cat";

  talk(): string {
    return "meow";
  }
}

class Bird implements Animal {
  name = "bird";

  talk(): string {
    return "chirp";
  }
}

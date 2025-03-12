class Todo {
  title: string | undefined = $state();
  done: boolean = $state(false);
  createdAt: Date = $state(new Date());

  constructor(title: string) {
    this.title = title;
  }

  public toggle(): void {
    this.done = !this.done;
  }
}

module.exports = Todo;

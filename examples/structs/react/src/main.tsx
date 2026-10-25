import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";

struct Todo {
  id: number;
  title: string;
  done: boolean;
  constructor(id: number, title: string) {
    this.id = id;
    this.title = title;
    this.done = false;
  }
}

// A store of struct instances. Every Todo has a fixed shape, so a mistyped field name fails loudly
// instead of silently adding a property.
class TodoStore {
  #todos: readonly Todo[] = [];
  #listeners = new Set<() => void>();
  #nextId = 1;

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  snapshot = () => this.#todos;

  add(title: string) {
    this.#todos = [...this.#todos, new Todo(this.#nextId++, title)];
    this.#emit();
  }

  toggle(id: number) {
    const todo = this.#todos.find(candidate => candidate.id === id);
    if (!todo) return;
    todo.done = !todo.done;
    // The array identity changes so useSyncExternalStore sees a new snapshot.
    this.#todos = [...this.#todos];
    this.#emit();
  }

  #emit() {
    for (const listener of this.#listeners) listener();
  }
}

const store = new TodoStore();
store.add("Try structs");
store.add("Bundle for the browser");

function App() {
  const todos = useSyncExternalStore(store.subscribe, store.snapshot);
  return (
    <main>
      <h1>Todos</h1>
      <form
        onSubmit={event => {
          event.preventDefault();
          const input = event.currentTarget.elements.namedItem("title") as HTMLInputElement;
          if (input.value.trim()) store.add(input.value.trim());
          input.value = "";
        }}
      >
        <input name="title" placeholder="What needs doing?" />
        <button type="submit">Add</button>
      </form>
      <ul>
        {todos.map(todo => (
          <li key={todo.id}>
            <label>
              <input type="checkbox" checked={todo.done} onChange={() => store.toggle(todo.id)} />
              <span style={{ textDecoration: todo.done ? "line-through" : "none" }}>{todo.title}</span>
            </label>
          </li>
        ))}
      </ul>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);

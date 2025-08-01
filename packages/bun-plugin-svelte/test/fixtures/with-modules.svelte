<script lang="ts">
  import { Todo } from "./todo.svelte";

  let name = "World";
  let todo: Todo = $state(new Todo("Hello World!"));
</script>

<main class="app">
  <h1>Hello {todo.title}!</h1>
  <!-- clicking calls toggle -->
  <input type="checkbox" bind:checked={todo.done} />
  <button onclick={todo.toggle}>Toggle</button>
</main>

<style>
  h1 {
    color: #ff3e00;
    text-align: center;
    font-size: 2em;
    font-weight: 100;
  }
  .app {
    box-sizing: border-box;
  }
</style>

<script lang="ts">
  let count = $state(5);
</script>
<svelte:head><title>smoke</title></svelte:head>
<main>
  <h1>a static page</h1>
  <ul>{#each [1, 2, 3] as n}<li>{n * n}</li>{/each}</ul>
  <button onclick={() => count++}>clicked {count} times</button>
</main>

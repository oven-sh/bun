<script lang="ts">
  let { data } = $props();
</script>
<main>
  <h1>a load function that awaits data</h1>
  <p>asked by {data.askedBy}, seen by the hook: {data.seen}</p>
  <ol>{#each data.people as person}<li>{person.name.toUpperCase()}</li>{/each}</ol>
</main>

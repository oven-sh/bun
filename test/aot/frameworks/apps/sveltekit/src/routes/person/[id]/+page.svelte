<script lang="ts">
  let { data } = $props();
</script>
<svelte:head><title>person {data.id}</title></svelte:head>
<p>person {data.id}, doubled {data.id * 2}, greeted with {data.greeting}</p>
